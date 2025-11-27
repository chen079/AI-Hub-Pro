import os
import json

# ================= 强制锁定密钥逻辑 =================
def get_fixed_secret_key():
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
    except:
        base_dir = os.getcwd()
        
    key_path = os.path.join(base_dir, 'key')
    final_key = ""
    
    if os.path.exists(key_path):
        try:
            with open(key_path, 'r', encoding='utf-8') as f:
                final_key = f.read().strip()
        except Exception as e:
            print(f"!!! 读取 Key 文件失败: {e}")
    
    if not final_key:
        print(f"--- 正在生成新的密钥文件: {key_path} ---")
        final_key = os.urandom(24).hex()
        try:
            with open(key_path, 'w', encoding='utf-8') as f:
                f.write(final_key)
        except Exception as e:
            print(f"!!! 写入 Key 文件失败: {e}")
            
    return final_key

class Config:
    SECRET_KEY = get_fixed_secret_key()
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    PAID_MODE = os.environ.get('PAID_MODE', 'False').lower() == 'true'
    
    # 数据库路径
    base_dir = os.path.dirname(os.path.abspath(__file__))
    SQLALCHEMY_DATABASE_URI = 'sqlite:///' + os.path.join(base_dir, 'users.db')

def load_official_config():
    try:
        if os.path.exists('official_key.json'):
            with open('official_key.json', 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f"Error loading official_key.json: {e}")
    return {}