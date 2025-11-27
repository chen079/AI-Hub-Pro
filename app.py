import os
import sqlite3
from flask import Flask
from config import Config
from extensions import db, login_manager

# 注册蓝图
from routes import auth, user, chat, main

app = Flask(__name__)
app.config.from_object(Config)

# 初始化插件
db.init_app(app)
login_manager.init_app(app)

# 注册 Blueprints
app.register_blueprint(auth.bp)
app.register_blueprint(user.bp)
app.register_blueprint(chat.bp)
app.register_blueprint(main.bp)

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        # 数据库迁移检查
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
            print(f"Migration check skipped: {e}")    
    
    port = int(os.environ.get('PORT', 5000))
    env_name = os.environ.get('FLASK_ENV', 'development')
    
    if env_name == 'production':
        try:
            from waitress import serve
            print(f"WARNING: Production mode detected.")
            print(f" * Serving with Waitress (Production WSGI Server)")
            print(f" * Listening on http://0.0.0.0:{port}")
            serve(app, host='0.0.0.0', port=port, threads=6)
        except ImportError:
            print("[Error] 'waitress' 模块未安装。请运行: pip install waitress")
            app.run(host='0.0.0.0', port=port, debug=False)
    else:
        print(f" * Environment: {env_name}")
        print(f" * Debug mode: On")
        print(f" * Listening on http://127.0.0.1:{port}")
        app.run(host='127.0.0.1', port=port, debug=True)