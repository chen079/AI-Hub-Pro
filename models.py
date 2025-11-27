from flask_login import UserMixin
from extensions import db, login_manager

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(150), nullable=False)
    settings = db.Column(db.Text, default='{}')
    points = db.Column(db.Integer, default=1000)

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))