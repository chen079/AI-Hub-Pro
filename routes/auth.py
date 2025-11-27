import json
from flask import Blueprint, request, jsonify, redirect, url_for
from flask_login import login_user, login_required, logout_user
from werkzeug.security import generate_password_hash, check_password_hash
from extensions import db
from models import User

bp = Blueprint('auth', __name__)

@bp.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('main.login_page')) # 注意这里的 endpoint 变了

@bp.route('/api/register', methods=['POST'])
def register():
    data = request.json
    if User.query.filter_by(username=data.get('username')).first():
        return jsonify({'success': False, 'message': '用户已存在'})
    
    hashed_pw = generate_password_hash(data.get('password'), method='pbkdf2:sha256')
    new_user = User(username=data.get('username'), password=hashed_pw)
    
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

@bp.route('/api/login', methods=['POST'])
def login():
    data = request.json
    user = User.query.filter_by(username=data.get('username')).first()
    if user and check_password_hash(user.password, data.get('password')):
        login_user(user)
        return jsonify({'success': True})
    return jsonify({'success': False, 'message': '用户名或密码错误'})