import os
import json
import base64
import io
import waitress
import sqlite3
from datetime import datetime


# 引入必要的库
import httpx  # 异步 HTTP 请求
from cryptography.fernet import Fernet # 加密工具
from pypdf import PdfReader # PDF 解析
from docx import Document # Word 解析

from flask import Flask, render_template, request, jsonify, redirect, url_for, Response, stream_with_context
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from PIL import Image

app = Flask(__name__)

# ================= 【新增】密钥加载函数 =================
def load_secret_key():
    """
    优先从根目录 'key' 文件读取密钥。
    如果文件不存在，自动生成一个并保存，确保下次启动一致。
    """
    key_path = 'key' # 文件名为 key，无后缀
    try:
        if os.path.exists(key_path):
            with open(key_path, 'r', encoding='utf-8') as f:
                key = f.read().strip()
                if key: return key
    except Exception as e:
        print(f"Warning: Failed to read key file: {e}")
    
    # 如果文件不存在或为空，生成新密钥并保存
    new_key = os.urandom(24).hex()
    try:
        with open(key_path, 'w', encoding='utf-8') as f:
            f.write(new_key)
        print(f"Created new secret key in '{key_path}' file.")
    except Exception as e:
        print(f"Warning: Could not save key file: {e}")
    
    return new_key

# ================= 【新增】加载官方 API 配置 =================
def load_official_config():
    try:
        if os.path.exists('official_key.json'):
            with open('official_key.json', 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f"Error loading official_key.json: {e}")
    return {}

# ================= 配置区域 (已修改为环境切换版) =================

class Config:
    """基础配置"""
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # 【修改】支持从环境变量读取字符串 "true"/"false" 并转为布尔值
    PAID_MODE = os.environ.get('PAID_MODE', 'False').lower() == 'true'
    # 默认密钥
    SECRET_KEY = load_secret_key()

class DevelopmentConfig(Config):
    """开发环境配置"""
    DEBUG = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///users.db'

class ProductionConfig(Config):
    """生产环境配置"""
    DEBUG = False
    # 生产环境必须从环境变量获取密钥，如果没有则随机生成（这会导致每次重启 session 失效，强制登出，是安全的兜底）
    SECRET_KEY = os.environ.get('SECRET_KEY') or os.urandom(24).hex()
    # 生产环境建议使用绝对路径，或者从环境变量读取数据库地址
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or 'sqlite:///' + os.path.join(os.getcwd(), 'users.db')

# 获取当前环境，默认为 'development'
env_name = os.environ.get('FLASK_ENV', 'development')

# 应用配置
if env_name == 'production':
    app.config.from_object(ProductionConfig)
else:
    app.config.from_object(DevelopmentConfig)

# 打印当前环境提示
print(f"Loaded configuration for: {env_name.upper()}")

db = SQLAlchemy(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login_page'

# ================= 安全加密工具 =================
# 使用 app 的 SECRET_KEY 派生一个固定的加密 Key
# 这样确保每次重启服务器后，之前加密的 API Key 还能解开
def get_cipher():
    # 截取 SECRET_KEY 并补全到 32 字节 base64 格式
    key = base64.urlsafe_b64encode(app.config['SECRET_KEY'].encode('utf-8').ljust(32)[:32])
    return Fernet(key)

def encrypt_val(value):
    """加密字符串"""
    if not value: return ""
    try:
        return get_cipher().encrypt(value.encode('utf-8')).decode('utf-8')
    except Exception as e:
        print(f"Encryption error: {e}")
        return ""

def decrypt_val(token):
    """解密字符串"""
    if not token: return ""
    try:
        return get_cipher().decrypt(token.encode('utf-8')).decode('utf-8')
    except Exception as e:
        print(f"Decryption error: {e}")
        return ""

# ================= 数据库模型 =================
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(150), nullable=False)
    settings = db.Column(db.Text, default='{}')
    # 【新增】用户点数，默认为 1000 (新人赠送)
    points = db.Column(db.Integer, default=1000)

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# ================= 价格计算逻辑 =================
PRICE_CONFIG_CACHE = None
def load_price_config():
    global PRICE_CONFIG_CACHE
    if PRICE_CONFIG_CACHE: return PRICE_CONFIG_CACHE
    try:
        with open('price.json', 'r', encoding='utf-8') as f:
            PRICE_CONFIG_CACHE = json.load(f)
            return PRICE_CONFIG_CACHE
    except:
        # 默认兜底结构
        return {"default": 100, "providers": {}, "overrides": {}}

# 4. 计算价格 (适配新的 price.json 结构)
def calculate_cost(model_name):
    """
    优先级: overrides > providers > default
    """
    config = load_price_config()
    name = model_name.lower()
    
    # A. 检查特殊覆盖规则 (Overrides)
    # 例如: "gpt-4" 应该比普通 "openai" 模型贵
    overrides = config.get('overrides', {})
    for keyword, price in overrides.items():
        if keyword in name:
            return price
            
    # B. 检查供应商规则 (Providers)
    provider_id = identify_provider(name)
    providers = config.get('providers', {})
    if provider_id in providers:
        return providers[provider_id]
            
    # C. 默认价格
    return config.get('default', 100)

@app.route('/api/user_status', methods=['GET'])
@login_required
def get_user_status():
    """【新增】获取用户状态（付费模式开关 + 余额）"""
    return jsonify({
        'paid_mode': app.config['PAID_MODE'],
        'points': current_user.points
    })

@app.route('/api/add_points', methods=['POST'])
@login_required
def add_points():
    """【新增】模拟充值接口"""
    if not app.config['PAID_MODE']:
        return jsonify({'success': False, 'message': '付费模式未开启'})
        
    data = request.json
    amount = int(data.get('amount', 0))
    
    if amount > 0:
        current_user.points += amount
        db.session.commit()
        return jsonify({'success': True, 'new_balance': current_user.points})
    return jsonify({'success': False, 'message': '无效金额'})

# ================= 辅助函数：文档解析 =================
def extract_text_from_file(file_storage):
    filename = file_storage.filename.lower()
    try:
        # 解析 PDF
        if filename.endswith('.pdf'):
            reader = PdfReader(file_storage.stream)
            text = "\n".join([page.extract_text() for page in reader.pages if page.extract_text()])
            return text[:15000] # 限制字符数，防止 Token 溢出
        
        # 解析 Word
        elif filename.endswith('.docx'):
            doc = Document(file_storage.stream)
            text = "\n".join([para.text for para in doc.paragraphs])
            return text[:15000]
        
        # 解析纯文本
        elif filename.endswith('.txt') or filename.endswith('.md') or filename.endswith('.py') or filename.endswith('.js'):
            # 【修改】增加 errors='replace' 防止遇到非 UTF-8 编码文件时报错
            return file_storage.stream.read().decode('utf-8', errors='replace')[:15000]
            
    except Exception as e:
        return f"[System Error: Failed to parse file {filename}. Reason: {str(e)}]"
    return None

# ================= 路由逻辑 =================

RULES_CACHE = None
def load_match_rules():
    global RULES_CACHE
    if RULES_CACHE: return RULES_CACHE
    try:
        with open('model_rules.json', 'r', encoding='utf-8') as f:
            RULES_CACHE = json.load(f)
            return RULES_CACHE
    except Exception as e:
        print(f"Error loading model_rules.json: {e}")
        return []

# 2. 修改 identify_provider 函数 (价格计算逻辑)
def identify_provider(model_name):
    if not model_name: return 'default'
    lower_name = model_name.lower()
    
    rules = load_match_rules()
    
    # 规则匹配
    for rule in rules:
        for keyword in rule.get('keywords', []):
            if keyword in lower_name:
                return rule['id']
    
    # 智能兜底逻辑 (处理 xxx/yyy:zzz 格式)
    if '/' in lower_name:
        return lower_name.split('/')[-1].split(':')[0].split('-')[0]
    return 'default'

@app.route('/')
def index():
    if not current_user.is_authenticated:
        return redirect(url_for('login_page'))
    
    # === [修改点] 读取规则并转换为 JSON 字符串传给前端 ===
    rules_json = json.dumps(load_match_rules())
    
    # 注意：这里需要把 rules_json 传给模板
    return render_template('index.html', rules_json=rules_json)

@app.route('/login')
def login_page():
    # 登录页也传一下，防止报错，虽然登录页用不到
    return render_template('index.html', view='login', rules_json='[]')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login_page'))

# --- 认证接口 ---

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    if User.query.filter_by(username=data.get('username')).first():
        return jsonify({'success': False, 'message': '用户已存在'})
    
    hashed_pw = generate_password_hash(data.get('password'), method='pbkdf2:sha256')
    new_user = User(username=data.get('username'), password=hashed_pw)
    
    # 默认设置
    default_settings = {
        "api_endpoint": "https://api.openai.com/v1",
        "api_key": "",
        "model": "gpt-3.5-turbo",
        "system_prompt": "You are a helpful assistant.",
        "dark_mode": False
    }
    new_user.settings = json.dumps(default_settings)
    
    db.session.add(new_user)
    db.session.commit()
    return jsonify({'success': True, 'message': '注册成功'})

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    user = User.query.filter_by(username=data.get('username')).first()
    if user and check_password_hash(user.password, data.get('password')):
        login_user(user)
        return jsonify({'success': True})
    return jsonify({'success': False, 'message': '用户名或密码错误'})

# --- 设置与用户数据接口 ---

@app.route('/api/settings', methods=['GET', 'POST'])
@login_required
def handle_settings():
    # 保存设置
    if request.method == 'POST':
        data = request.json
        
        # 如果修改密码
        if 'new_password' in data and data['new_password']:
            current_user.password = generate_password_hash(data['new_password'], method='pbkdf2:sha256')
        
        current_settings = json.loads(current_user.settings)
        
        for key, value in data.items():
            # 特殊处理 API Key：如果不是乱码（即用户输入了新 Key），则加密存储
            if key == 'api_key':
                if value and not value.startswith('gAAAA'): # 简单的 Fernet 头部检查
                    current_settings[key] = encrypt_val(value)
                # 如果是空字符串，则保存为空
                elif value == "":
                    current_settings[key] = ""
                # 否则保持原样（即保持已加密的字符串）
            elif key != 'new_password':
                current_settings[key] = value
        
        current_user.settings = json.dumps(current_settings)
        db.session.commit()
        return jsonify({'success': True})
    
    # 获取设置
    settings = json.loads(current_user.settings)
    
    # 解密 Key 发回前端（如果不希望前端看到 Key，可以在这里只返回 '******'）
    # 但为了方便用户修改，通常还是解密发回
    if settings.get('api_key'):
        # 尝试解密，如果解密失败（比如旧数据是明文），则直接返回原值
        decrypted = decrypt_val(settings['api_key'])
        if not decrypted and settings['api_key']:
             # 兼容旧版本明文 Key
             decrypted = settings['api_key']
        settings['api_key'] = decrypted
        
    settings['account_username'] = current_user.username
    return jsonify(settings)

@app.route('/api/upload_avatar', methods=['POST'])
@login_required
def upload_avatar():
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': '没有文件'})
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'message': '未选择文件'})

    try:
        # 使用 Pillow 处理图片
        img = Image.open(file.stream)
        if img.mode != 'RGB':
            img = img.convert('RGB')
        # 压缩图片
        img.thumbnail((128, 128)) 
        buffered = io.BytesIO()
        img.save(buffered, format="JPEG", quality=85)
        img_str = base64.b64encode(buffered.getvalue()).decode('utf-8')
        avatar_data = f"data:image/jpeg;base64,{img_str}"
        
        # 保存到数据库
        settings = json.loads(current_user.settings)
        settings['user_avatar'] = avatar_data
        current_user.settings = json.dumps(settings)
        db.session.commit()
        
        return jsonify({'success': True, 'avatar': avatar_data})
    except Exception as e:
        return jsonify({'success': False, 'message': f"Image Error: {str(e)}"})

# --- 核心功能接口 ---

@app.route('/api/test_connection', methods=['POST'])
@login_required
def test_connection():
    data = request.json
    
    # === 新增：检查是否测试官方通道 ===
    use_official = data.get('use_official', False)
    paid_mode = app.config.get('PAID_MODE', False)

    if use_official and paid_mode:
        # 加载服务器端的官方配置
        off_conf = load_official_config()
        api_endpoint = off_conf.get('api_endpoint', '').strip()
        api_key = off_conf.get('api_key', '').strip()
        
        if not api_endpoint or not api_key:
            return jsonify({'success': False, 'message': '测试失败：服务器端官方配置缺失 (official_key.json)'})
    else:
        # === 原有逻辑：测试用户自定义配置 ===
        api_endpoint = data.get('api_endpoint', '').strip()
        api_key = data.get('api_key', '').strip()

        if not api_endpoint:
            return jsonify({'success': False, 'message': 'API Endpoint 不能为空'})
        
        # 尝试解密数据库存的 Key
        if not api_key:
            settings = json.loads(current_user.settings)
            saved_key = settings.get('api_key', '')
            if saved_key:
                api_key = decrypt_val(saved_key)
                
        if not api_key:
            return jsonify({'success': False, 'message': 'API Key 不能为空'})

    # 构造请求头
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    # 构造测试 URL：通常 LLM API 都有 /models 接口
    # 移除 endpoint 末尾的 '/'，然后拼接 '/models'
    base_url = api_endpoint.rstrip('/')
    test_url = f"{base_url}/models"

    try:
        # 设置 10秒超时，避免长时间卡顿
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(test_url, headers=headers)
            
            if resp.status_code == 200:
                try:
                    data = resp.json()
                    # 尝试获取模型数量，增加反馈的真实感
                    count = len(data.get('data', [])) if 'data' in data else 0
                    msg = f"连接成功！服务器返回了 {count} 个可用模型。"
                    return jsonify({'success': True, 'message': msg})
                except:
                    return jsonify({'success': True, 'message': "连接成功！(但返回格式非标准 JSON)"})
            elif resp.status_code == 401:
                return jsonify({'success': False, 'message': "连接失败：API Key 无效或过期 (401)"})
            elif resp.status_code == 404:
                return jsonify({'success': False, 'message': "连接失败：接口路径不存在 (404)，请检查 Endpoint 是否正确"})
            else:
                return jsonify({'success': False, 'message': f"连接失败：HTTP 状态码 {resp.status_code}"})
                
    except Exception as e:
        return jsonify({'success': False, 'message': f"网络请求错误: {str(e)}"})


@app.route('/api/parse_doc', methods=['POST'])
@login_required
def parse_doc():
    """解析文档并返回文本"""
    if 'file' not in request.files:
        return jsonify({'success': False, 'message': 'No file'})
    
    file = request.files['file']
    text = extract_text_from_file(file)
    
    if text:
        return jsonify({'success': True, 'text': text})
    return jsonify({'success': False, 'message': '无法解析文件内容或文件不支持'})

@app.route('/api/fetch_models', methods=['POST'])
@login_required
def fetch_models():
    settings = json.loads(current_user.settings)
    
    # === 【修改】判断是否使用官方源 ===
    use_official = settings.get('use_official_api', False)
    
    # 只有在付费模式开启，且用户勾选了官方API时，才切换
    if app.config['PAID_MODE'] and use_official:
        off_conf = load_official_config()
        api_key = off_conf.get('api_key')
        api_endpoint = off_conf.get('api_endpoint')
    else:
        # 否则使用用户自己的
        api_key = decrypt_val(settings.get('api_key'))
        api_endpoint = settings.get('api_endpoint')
    # ==================================

    if not api_key or not api_endpoint:
        return jsonify({'success': False, 'message': 'API Key 或 Endpoint 未配置'})

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    try:
        url = f"{api_endpoint.rstrip('/')}/models"
        # 使用 httpx 进行同步请求 (为了代码简单，这里不用 async)
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(url, headers=headers)
        
        if resp.status_code == 200:
            data = resp.json()
            # 兼容 OpenAI 标准格式
            if 'data' in data:
                model_ids = sorted([item['id'] for item in data['data']])
                return jsonify({'success': True, 'models': model_ids})
            else:
                return jsonify({'success': False, 'message': 'API 返回数据格式不标准'})
        else:
            return jsonify({'success': False, 'message': f'获取失败: {resp.status_code}'})
    except Exception as e:
        return jsonify({'success': False, 'message': f"Network Error: {str(e)}"})

# ================= 新增辅助函数 =================

def extract_by_path(json_obj, path_str):
    """
    根据点号路径提取 JSON 内容
    例如: path="choices[0].delta.content" -> json_obj['choices'][0]['delta']['content']
    """
    try:
        keys = path_str.replace('[', '.').replace(']', '').split('.')
        current = json_obj
        for key in keys:
            if key == '': continue
            if isinstance(current, list):
                key = int(key) # 处理数组索引
            current = current[key]
        return current
    except:
        return None

def build_dynamic_payload(template_str, model, messages, system_prompt):
    """
    根据用户定义的 JSON 模板构建请求体
    """
    try:
        # 如果模板为空，返回默认 OpenAI 格式
        if not template_str:
            return {
                "model": model,
                "messages": [{"role": "system", "content": system_prompt}] + messages,
                "temperature": 0.7,
                "stream": True
            }

        # 1. 预处理：将模板解析为 Python 对象
        payload = json.loads(template_str)

        # 2. 递归替换函数
        def recursive_replace(obj):
            if isinstance(obj, dict):
                return {k: recursive_replace(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [recursive_replace(i) for i in obj]
            elif isinstance(obj, str):
                # 替换占位符
                if obj == "{{MESSAGES}}":
                    return [{"role": "system", "content": system_prompt}] + messages
                if obj == "{{MODEL}}":
                    return model
                if obj == "{{SYSTEM_PROMPT}}":
                    return system_prompt
                # 如果用户需要纯文本 Prompt (用于 Completions API)
                if obj == "{{LAST_MSG_CONTENT}}":
                    return messages[-1]['content'] if messages else ""
                return obj
            else:
                return obj

        return recursive_replace(payload)
    except Exception as e:
        print(f"Payload Build Error: {e}")
        # 出错回退到默认
        return {
            "model": model,
            "messages": [{"role": "system", "content": system_prompt}] + messages,
            "temperature": 0.7,
            "stream": True
        }
    
@app.route('/api/chat', methods=['POST'])
@login_required
def chat(): 
    data = request.json
    messages = data.get('messages', [])
    settings = json.loads(current_user.settings)
    
    # === 【修改】核心逻辑：判断凭证来源和扣费 ===
    use_official = settings.get('use_official_api', False)
    paid_mode_on = app.config.get('PAID_MODE', False)
    
    # 默认值
    api_key = ""
    api_endpoint = ""
    
    # 判定是否使用官方渠道
    using_official_channel = paid_mode_on and use_official

    if using_official_channel:
        # A. 使用官方配置
        off_conf = load_official_config()
        api_key = off_conf.get('api_key')
        api_endpoint = off_conf.get('api_endpoint')
        
        # 官方渠道强制覆盖模型（可选，或者允许用户选模型但走官方Key）
        # model_name = settings.get('model', 'gpt-3.5-turbo') 
        
        if not api_key:
            return jsonify({'error': 'Server Official Config Missing'}), 500
    else:
        # B. 使用用户自定义配置
        raw_key = settings.get('api_key')
        api_key = decrypt_val(raw_key)
        if not api_key and raw_key: api_key = raw_key
        api_endpoint = settings.get('api_endpoint')

    if not api_key: return jsonify({'error': 'No API Key Configured'}), 400

    model_name = settings.get('model', 'gpt-3.5-turbo')

    # === 【修改】仅在使用官方渠道时扣费 ===
    if using_official_channel:
        cost = calculate_cost(model_name)
        if current_user.points < cost:
            return jsonify({'error': f'点数不足！官方通道需要 {cost} 点，您仅有 {current_user.points} 点。请充值或取消勾选官方API使用自己的Key。'}), 402
        
        current_user.points -= cost
        db.session.commit()

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    # 1. 获取用户自定义配置
    request_template = settings.get('custom_request_template', '')
    response_path = settings.get('custom_response_path', '')
    
    # 如果用户没填，使用默认 OpenAI 路径
    if not response_path:
        response_path = "choices[0].delta.content"

    # 2. 构建动态 Payload
    payload = build_dynamic_payload(
        request_template, 
        model_name, 
        messages, 
        settings.get('system_prompt', '')
    )

    # ================= [优化] URL 构建逻辑 =================
    clean_endpoint = api_endpoint.strip().rstrip('/')
    
    if clean_endpoint.endswith('/chat/completions'):
        url = clean_endpoint
    else:
        url = f"{clean_endpoint}/chat/completions"
    # ======================================================

    def generate():
        try:
            # 标记是否已经开始/结束思考，用于手动包裹 <think> 标签
            thinking_state = {
                'has_started': False,
                'has_ended': False
            }

            # 增加超时时间到 120秒
            with httpx.Client(timeout=120.0) as client:
                with client.stream("POST", url, json=payload, headers=headers) as response:
                    
                    if response.status_code != 200:
                        err_text = response.read().decode('utf-8')
                        yield f"data: {json.dumps({'error': f'API Error {response.status_code}: {err_text}'})}\n\n"
                        return

                    for line in response.iter_lines():
                        if line:
                            decoded_line = line
                            
                            # 处理 SSE 数据前缀
                            if decoded_line.startswith("data: "):
                                json_str = decoded_line[6:]
                            elif decoded_line.startswith("{"):
                                json_str = decoded_line
                            else:
                                continue

                            if json_str.strip() == "[DONE]":
                                # 如果思考还没闭合，强制闭合
                                if thinking_state['has_started'] and not thinking_state['has_ended']:
                                     yield f"data: {json.dumps({'choices': [{'delta': {'content': '</think>'}}]})}\n\n"
                                yield "data: [DONE]\n\n"
                                continue
                                
                            try:
                                json_data = json.loads(json_str)
                                
                                # === [修改核心] 深度适配 DeepSeek Reasoner ===
                                # 尝试直接获取 delta 对象，应对 OpenAI 格式
                                choices = json_data.get('choices', [])
                                delta = choices[0].get('delta', {}) if choices else {}

                                # 1. 处理思维链 (reasoning_content)
                                reasoning = delta.get('reasoning_content', '')
                                if reasoning:
                                    # 如果是第一次收到思考内容，发送 <think> 标签
                                    if not thinking_state['has_started']:
                                        yield f"data: {json.dumps({'choices': [{'delta': {'content': '<think>'}}]})}\n\n"
                                        thinking_state['has_started'] = True
                                    
                                    # 发送思考内容 (伪装成 content 发给前端，因为前端只认 content)
                                    yield f"data: {json.dumps({'choices': [{'delta': {'content': reasoning}}]})}\n\n"
                                    continue # 既然是思考，处理完这就跳过 content 检查

                                # 2. 处理正式回答 (content)
                                content = extract_by_path(json_data, response_path)
                                
                                if content:
                                    # 如果之前在思考且还没闭合，说明思考结束，正式回答开始，发送 </think>
                                    if thinking_state['has_started'] and not thinking_state['has_ended']:
                                        yield f"data: {json.dumps({'choices': [{'delta': {'content': '</think>'}}]})}\n\n"
                                        thinking_state['has_ended'] = True

                                    # 发送正式内容
                                    chunk = {
                                        "choices": [{"delta": {"content": content}}]
                                    }
                                    yield f"data: {json.dumps(chunk)}\n\n"

                            except Exception as e:
                                # 忽略解析错误
                                pass
        except Exception as e:
             yield f"data: {json.dumps({'error': f'Server Error: {str(e)}'})}\n\n"

    return Response(stream_with_context(generate()), mimetype='text/event-stream')

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        try:
            inspector = db.inspect(db.engine)
            columns = [c['name'] for c in inspector.get_columns('user')]
            if 'points' not in columns:
                print("Detected missing 'points' column. Migrating database...")
                with sqlite3.connect('users.db') as conn:
                    cursor = conn.cursor()
                    cursor.execute('ALTER TABLE user ADD COLUMN points INTEGER DEFAULT 1000')
                    conn.commit()
                print("Migration successful.")
        except Exception as e:
            # 如果是生产环境数据库路径不同，或者全新数据库，可能会跳过此步，不影响运行
            print(f"Migration check skipped: {e}")    
    
    # 获取端口
    port = int(os.environ.get('PORT', 5000))
    
    # 根据环境选择启动方式
    if env_name == 'production':
        # --- 生产环境 (使用 Waitress) ---
        try:
            from waitress import serve
            print(f"WARNING: Production mode detected.")
            print(f" * Serving with Waitress (Production WSGI Server)")
            print(f" * Listening on http://0.0.0.0:{port}")
            # threads=6 支持并发，避免一个人生成时卡住其他人
            serve(app, host='0.0.0.0', port=port, threads=6)
        except ImportError:
            print("[Error] 'waitress' 模块未安装。请运行: pip install waitress")
            print("正在回退到 Flask 开发服务器 (不建议用于生产)...")
            app.run(host='0.0.0.0', port=port, debug=False)
    else:
        # --- 开发环境 (使用 Flask 自带) ---
        print(f" * Environment: {env_name}")
        print(f" * Debug mode: On")
        print(f" * Listening on http://127.0.0.1:{port}")
        app.run(host='127.0.0.1', port=port, debug=True)