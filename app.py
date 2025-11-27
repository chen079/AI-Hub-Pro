import os
import json
import base64
import io
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

# ================= 配置区域 =================
# 警告：在生产环境中，请将密钥改为随机字符串并保存在环境变量中
app.config['SECRET_KEY'] = 'change-this-to-a-secure-random-key-in-production' 
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///users.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

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
    # 存储 JSON 格式的配置信息
    settings = db.Column(db.Text, default='{}')

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

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

@app.route('/')
def index():
    if not current_user.is_authenticated:
        return redirect(url_for('login_page'))
    return render_template('index.html')

@app.route('/login')
def login_page():
    return render_template('index.html', view='login')

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
    api_endpoint = data.get('api_endpoint', '').strip()
    api_key = data.get('api_key', '').strip()

    if not api_endpoint:
        return jsonify({'success': False, 'message': 'API Endpoint 不能为空'})
    
    # 如果用户没有修改 Key（前端传空），且数据库里有 Key，则使用数据库里的（需要解密）
    if not api_key:
        settings = json.loads(current_user.settings)
        saved_key = settings.get('api_key', '')
        if saved_key:
            api_key = decrypt_val(saved_key) # 使用之前定义的解密函数
            
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
    """获取模型列表 (这是之前缺失的路由)"""
    settings = json.loads(current_user.settings)
    api_key = decrypt_val(settings.get('api_key'))
    api_endpoint = settings.get('api_endpoint')

    if not api_key or not api_endpoint:
        return jsonify({'success': False, 'message': '请先配置 API Key 和 Endpoint'})

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
    raw_key = settings.get('api_key')
    api_key = decrypt_val(raw_key)
    
    if not api_key and raw_key: api_key = raw_key
    if not api_key: return jsonify({'error': 'No API Key Configured'}), 400

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
        settings.get('model', 'gpt-3.5-turbo'), 
        messages, 
        settings.get('system_prompt', '')
    )

    url = f"{settings.get('api_endpoint', '').rstrip('/')}/chat/completions"
    
    # 注意：如果用户自定义了 Endpoint 的完整路径（不仅是 host），这里需要处理
    # 简单的做法：如果 Endpoint 以 http 开头且包含 /chat/completions 等后缀，就不拼接
    # 这里为了兼容性，假设用户填写的只是 Base URL

    def generate():
        try:
            # 增加超时时间
            with httpx.Client(timeout=120.0) as client:
                with client.stream("POST", url, json=payload, headers=headers) as response:
                    
                    if response.status_code != 200:
                        err_text = response.read().decode('utf-8')
                        yield f"data: {json.dumps({'error': f'API Error {response.status_code}: {err_text}'})}\n\n"
                        return

                    for line in response.iter_lines():
                        if line:
                            decoded_line = line
                            
                            # 3. 处理数据前缀 (OpenAI 是 data:，有些是 event: data:)
                            if decoded_line.startswith("data: "):
                                json_str = decoded_line[6:]
                            elif decoded_line.startswith("{"):
                                json_str = decoded_line # 兼容直接返回 JSON 的流
                            else:
                                continue

                            if json_str.strip() == "[DONE]":
                                yield "data: [DONE]\n\n"
                                continue
                                
                            try:
                                json_data = json.loads(json_str)
                                
                                # 4. 使用用户自定义路径提取内容
                                content = extract_by_path(json_data, response_path)
                                
                                if content:
                                    # 重新封装成标准 OpenAI 格式发给前端，这样前端不用改解析逻辑
                                    chunk = {
                                        "choices": [{"delta": {"content": content}}]
                                    }
                                    yield f"data: {json.dumps(chunk)}\n\n"
                            except Exception as e:
                                # 忽略解析错误，继续下一行
                                pass
        except Exception as e:
             yield f"data: {json.dumps({'error': f'Server Error: {str(e)}'})}\n\n"

    return Response(stream_with_context(generate()), mimetype='text/event-stream')

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    # 生产环境建议使用: hypercorn app:app --bind 0.0.0.0:5000
    app.run(debug=True, port=5000, threaded=True)