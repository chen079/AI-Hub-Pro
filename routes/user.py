import json
import io
import base64
from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
from werkzeug.security import generate_password_hash
from PIL import Image
from extensions import db
from utils import encrypt_val, decrypt_val

bp = Blueprint('user', __name__)

@bp.route('/api/user_status', methods=['GET'])
@login_required
def get_user_status():
    return jsonify({
        'paid_mode': current_app.config['PAID_MODE'],
        'points': current_user.points
    })

@bp.route('/api/add_points', methods=['POST'])
@login_required
def add_points():
    if not current_app.config['PAID_MODE']:
        return jsonify({'success': False, 'message': '付费模式未开启'})
    data = request.json
    amount = int(data.get('amount', 0))
    if amount > 0:
        current_user.points += amount
        db.session.commit()
        return jsonify({'success': True, 'new_balance': current_user.points})
    return jsonify({'success': False, 'message': '无效金额'})

@bp.route('/api/settings', methods=['GET', 'POST'])
@login_required
def handle_settings():
    if request.method == 'POST':
        data = request.json
        if 'new_password' in data and data['new_password']:
            current_user.password = generate_password_hash(data['new_password'], method='pbkdf2:sha256')
        
        current_settings = json.loads(current_user.settings)
        for key, value in data.items():
            if key == 'api_key':
                if value is None: value = ""
                value = value.strip()
                if value.startswith('gAAAA'):
                    current_settings[key] = value
                elif value:
                    current_settings[key] = encrypt_val(value)
                else:
                    current_settings[key] = ""
            elif key != 'new_password':
                current_settings[key] = value
        
        current_user.settings = json.dumps(current_settings)
        db.session.commit()
        return jsonify({'success': True})
    
    settings = json.loads(current_user.settings)
    if settings.get('api_key'):
        decrypted = decrypt_val(settings['api_key'])
        if not decrypted: decrypted = settings['api_key']
        settings['api_key'] = decrypted
    settings['account_username'] = current_user.username
    return jsonify(settings)

@bp.route('/api/upload_avatar', methods=['POST'])
@login_required
def upload_avatar():
    if 'file' not in request.files: return jsonify({'success': False, 'message': '没有文件'})
    file = request.files['file']
    if file.filename == '': return jsonify({'success': False, 'message': '未选择文件'})

    try:
        img = Image.open(file.stream)
        if img.mode != 'RGB': img = img.convert('RGB')
        img.thumbnail((128, 128))
        buffered = io.BytesIO()
        img.save(buffered, format="JPEG", quality=85)
        img_str = base64.b64encode(buffered.getvalue()).decode('utf-8')
        avatar_data = f"data:image/jpeg;base64,{img_str}"
        
        settings = json.loads(current_user.settings)
        settings['user_avatar'] = avatar_data
        current_user.settings = json.dumps(settings)
        db.session.commit()
        return jsonify({'success': True, 'avatar': avatar_data})
    except Exception as e:
        return jsonify({'success': False, 'message': f"Image Error: {str(e)}"})