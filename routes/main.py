import json
from flask import Blueprint, render_template, redirect, url_for
from flask_login import current_user
from utils import load_match_rules

bp = Blueprint('main', __name__)

@bp.route('/')
def index():
    if not current_user.is_authenticated:
        return redirect(url_for('main.login_page'))
    rules_json = json.dumps(load_match_rules())
    return render_template('index.html', rules_json=rules_json)

@bp.route('/login')
def login_page():
    return render_template('index.html', view='login', rules_json='[]')