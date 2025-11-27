import os
import json
import base64
from cryptography.fernet import Fernet
from flask import current_app
from pypdf import PdfReader
from docx import Document

# ================= 安全加密工具 =================
def get_cipher():
    key = base64.urlsafe_b64encode(current_app.config['SECRET_KEY'].encode('utf-8').ljust(32)[:32])
    return Fernet(key)

def encrypt_val(value):
    if not value: return ""
    try:
        return get_cipher().encrypt(value.encode('utf-8')).decode('utf-8')
    except Exception as e:
        print(f"Encryption error: {e}")
        return ""

def decrypt_val(token):
    if not token: return ""
    try:
        return get_cipher().decrypt(token.encode('utf-8')).decode('utf-8')
    except Exception as e:
        print(f"Decryption error: {e}")
        return ""

# ================= 价格与规则 =================
def load_price_config():
    try:
        with open('price.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return {"default": 100, "providers": {}, "overrides": {}}

def load_match_rules():
    try:
        with open('model_rules.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return []

def identify_provider(model_name):
    if not model_name: return 'default'
    lower_name = model_name.lower()
    rules = load_match_rules()
    for rule in rules:
        for keyword in rule.get('keywords', []):
            if keyword in lower_name:
                return rule['id']
    if '/' in lower_name:
        return lower_name.split('/')[-1].split(':')[0].split('-')[0]
    return 'default'

def calculate_cost(model_name):
    config = load_price_config()
    name = model_name.lower()
    overrides = config.get('overrides', {})
    for keyword, price in overrides.items():
        if keyword in name: return price
    provider_id = identify_provider(name)
    providers = config.get('providers', {})
    if provider_id in providers: return providers[provider_id]
    return config.get('default', 100)

# ================= 文档与 JSON 工具 =================
def extract_text_from_file(file_storage):
    filename = file_storage.filename.lower()
    try:
        if filename.endswith('.pdf'):
            reader = PdfReader(file_storage.stream)
            text = "\n".join([page.extract_text() for page in reader.pages if page.extract_text()])
            return text[:15000]
        elif filename.endswith('.docx'):
            doc = Document(file_storage.stream)
            text = "\n".join([para.text for para in doc.paragraphs])
            return text[:15000]
        elif filename.endswith(('.txt', '.md', '.py', '.js')):
            return file_storage.stream.read().decode('utf-8', errors='replace')[:15000]
    except Exception as e:
        return f"[System Error: Failed to parse file {filename}. Reason: {str(e)}]"
    return None

def extract_by_path(json_obj, path_str):
    try:
        keys = path_str.replace('[', '.').replace(']', '').split('.')
        current = json_obj
        for key in keys:
            if key == '': continue
            if isinstance(current, list): key = int(key)
            current = current[key]
        return current
    except:
        return None

def build_dynamic_payload(template_str, model, messages, system_prompt):
    if not template_str:
        return {
            "model": model,
            "messages": [{"role": "system", "content": system_prompt}] + messages,
            "temperature": 0.7,
            "stream": True
        }
    try:
        payload = json.loads(template_str)
        def recursive_replace(obj):
            if isinstance(obj, dict): return {k: recursive_replace(v) for k, v in obj.items()}
            elif isinstance(obj, list): return [recursive_replace(i) for i in obj]
            elif isinstance(obj, str):
                if obj == "{{MESSAGES}}": return [{"role": "system", "content": system_prompt}] + messages
                if obj == "{{MODEL}}": return model
                if obj == "{{SYSTEM_PROMPT}}": return system_prompt
                if obj == "{{LAST_MSG_CONTENT}}": return messages[-1]['content'] if messages else ""
                return obj
            else: return obj
        return recursive_replace(payload)
    except Exception as e:
        print(f"Payload Build Error: {e}")
        return {
            "model": model,
            "messages": [{"role": "system", "content": system_prompt}] + messages,
            "temperature": 0.7,
            "stream": True
        }