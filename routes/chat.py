import json
import httpx
from flask import Blueprint, request, jsonify, Response, stream_with_context, current_app
from flask_login import login_required, current_user
from extensions import db
from config import load_official_config
from utils import decrypt_val, calculate_cost, build_dynamic_payload, extract_by_path, extract_text_from_file

bp = Blueprint('chat', __name__)

@bp.route('/api/test_connection', methods=['POST'])
@login_required
def test_connection():
    data = request.json
    use_official = data.get('use_official', False)
    paid_mode = current_app.config.get('PAID_MODE', False)

    if use_official and paid_mode:
        off_conf = load_official_config()
        api_endpoint = off_conf.get('api_endpoint', '').strip()
        api_key = off_conf.get('api_key', '').strip()
        if not api_endpoint or not api_key:
            return jsonify({'success': False, 'message': '测试失败：服务器端官方配置缺失'})
    else:
        api_endpoint = data.get('api_endpoint', '').strip()
        api_key = data.get('api_key', '').strip()
        if not api_endpoint: return jsonify({'success': False, 'message': 'API Endpoint 不能为空'})
        if not api_key:
            settings = json.loads(current_user.settings)
            saved_key = settings.get('api_key', '')
            if saved_key: api_key = decrypt_val(saved_key)
        if not api_key: return jsonify({'success': False, 'message': 'API Key 不能为空'})

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    base_url = api_endpoint.rstrip('/')
    test_url = f"{base_url}/models"
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(test_url, headers=headers)
            if resp.status_code == 200:
                try:
                    data = resp.json()
                    count = len(data.get('data', [])) if 'data' in data else 0
                    msg = f"连接成功！{'官方通道' if use_official else ''}返回了 {count} 个可用模型。"
                    return jsonify({'success': True, 'message': msg})
                except:
                    return jsonify({'success': True, 'message': "连接成功！(但返回格式非标准 JSON，请检查是否缺少 /v1)"})
            elif resp.status_code == 401:
                return jsonify({'success': False, 'message': "连接失败：API Key 无效或过期 (401)"})
            elif resp.status_code == 404:
                return jsonify({'success': False, 'message': "连接失败：接口路径不存在 (404)，请尝试在 Endpoint 后加上 /v1"})
            else:
                return jsonify({'success': False, 'message': f"连接失败：HTTP 状态码 {resp.status_code}"})
    except Exception as e:
        return jsonify({'success': False, 'message': f"网络请求错误: {str(e)}"})

@bp.route('/api/parse_doc', methods=['POST'])
@login_required
def parse_doc():
    if 'file' not in request.files: return jsonify({'success': False, 'message': 'No file'})
    file = request.files['file']
    text = extract_text_from_file(file)
    if text: return jsonify({'success': True, 'text': text})
    return jsonify({'success': False, 'message': '无法解析文件内容或文件不支持'})

@bp.route('/api/fetch_models', methods=['POST'])
@login_required
def fetch_models():
    data = request.json or {}
    saved_settings = json.loads(current_user.settings)
    use_official = data.get('use_official', saved_settings.get('use_official_api', False))
    
    api_key = ""
    api_endpoint = ""

    if current_app.config['PAID_MODE'] and use_official:
        off_conf = load_official_config()
        api_key = off_conf.get('api_key')
        api_endpoint = off_conf.get('api_endpoint')
    else:
        api_endpoint = data.get('api_endpoint')
        api_key = data.get('api_key')
        if not api_endpoint: api_endpoint = saved_settings.get('api_endpoint')
        if not api_key:
            encrypted_key = saved_settings.get('api_key')
            if encrypted_key: api_key = decrypt_val(encrypted_key)

    if not api_key or not api_endpoint:
        return jsonify({'success': False, 'message': '请先配置 API Key 和 Endpoint'})

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    base_url = api_endpoint.rstrip('/')
    urls_to_try = []
    if not base_url.endswith('/v1'): urls_to_try.append(f"{base_url}/v1/models")
    urls_to_try.append(f"{base_url}/models")

    error_msg = ""
    with httpx.Client(timeout=15.0) as client:
        for url in urls_to_try:
            try:
                resp = client.get(url, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    if 'data' in data:
                        model_ids = sorted([item['id'] for item in data['data']])
                        return jsonify({'success': True, 'models': model_ids})
            except Exception as e:
                error_msg = str(e)
                continue
    return jsonify({'success': False, 'message': f'获取失败 (请检查Key或Endpoint格式): {error_msg or "无法连接"}'})

@bp.route('/api/chat', methods=['POST'])
@login_required
def chat(): 
    data = request.json
    messages = data.get('messages', [])
    settings = json.loads(current_user.settings)
    
    use_official = settings.get('use_official_api', False)
    paid_mode_on = current_app.config.get('PAID_MODE', False)
    
    api_key = ""
    api_endpoint = ""
    using_official_channel = paid_mode_on and use_official

    if using_official_channel:
        off_conf = load_official_config()
        api_key = off_conf.get('api_key')
        api_endpoint = off_conf.get('api_endpoint')
        if not api_key: return jsonify({'error': 'Server Official Config Missing'}), 500
    else:
        raw_key = settings.get('api_key')
        api_key = decrypt_val(raw_key)
        if not api_key and raw_key: api_key = raw_key
        api_endpoint = settings.get('api_endpoint')

    if not api_key: return jsonify({'error': 'No API Key Configured'}), 400

    model_name = settings.get('model', 'gpt-3.5-turbo')

    if using_official_channel:
        cost = calculate_cost(model_name)
        if current_user.points < cost:
            return jsonify({'error': f'点数不足！官方通道需要 {cost} 点，您仅有 {current_user.points} 点。'}), 402
        current_user.points -= cost
        db.session.commit()

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    request_template = settings.get('custom_request_template', '')
    response_path = settings.get('custom_response_path', '')
    if not response_path: response_path = "choices[0].delta.content"

    payload = build_dynamic_payload(request_template, model_name, messages, settings.get('system_prompt', ''))
    clean_endpoint = api_endpoint.strip().rstrip('/')
    url = clean_endpoint if clean_endpoint.endswith('/chat/completions') else f"{clean_endpoint}/chat/completions"

    def generate():
        try:
            thinking_state = {'has_started': False, 'has_ended': False}
            with httpx.Client(timeout=120.0) as client:
                with client.stream("POST", url, json=payload, headers=headers) as response:
                    if response.status_code != 200:
                        err_text = response.read().decode('utf-8')
                        yield f"data: {json.dumps({'error': f'API Error {response.status_code}: {err_text}'})}\n\n"
                        return

                    for line in response.iter_lines():
                        if line:
                            decoded_line = line
                            if decoded_line.startswith("data: "): json_str = decoded_line[6:]
                            elif decoded_line.startswith("{"): json_str = decoded_line
                            else: continue

                            if json_str.strip() == "[DONE]":
                                if thinking_state['has_started'] and not thinking_state['has_ended']:
                                     yield f"data: {json.dumps({'choices': [{'delta': {'content': '</think>'}}]})}\n\n"
                                yield "data: [DONE]\n\n"
                                continue
                                
                            try:
                                json_data = json.loads(json_str)
                                choices = json_data.get('choices', [])
                                delta = choices[0].get('delta', {}) if choices else {}
                                reasoning = delta.get('reasoning_content', '')
                                if reasoning:
                                    if not thinking_state['has_started']:
                                        yield f"data: {json.dumps({'choices': [{'delta': {'content': '<think>'}}]})}\n\n"
                                        thinking_state['has_started'] = True
                                    yield f"data: {json.dumps({'choices': [{'delta': {'content': reasoning}}]})}\n\n"
                                    continue

                                content = extract_by_path(json_data, response_path)
                                if content:
                                    if thinking_state['has_started'] and not thinking_state['has_ended']:
                                        yield f"data: {json.dumps({'choices': [{'delta': {'content': '</think>'}}]})}\n\n"
                                        thinking_state['has_ended'] = True
                                    yield f"data: {json.dumps({'choices': [{'delta': {'content': content}}]})}\n\n"
                            except Exception as e: pass
        except Exception as e:
             yield f"data: {json.dumps({'error': f'Server Error: {str(e)}'})}\n\n"

    return Response(stream_with_context(generate()), mimetype='text/event-stream')