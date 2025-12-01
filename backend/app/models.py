from typing import Optional
from datetime import datetime
from sqlmodel import Field, SQLModel

# ユーザーモデル
# データベースの 'user' テーブルに対応します
class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True) # 主キー (自動採番)
    username: str = Field(index=True, unique=True) # ユーザー名 (重複不可、検索用インデックス付き)
    hashed_password: str # ハッシュ化されたパスワード (平文では保存しません)
    is_admin: bool = Field(default=False) # 管理者フラグ
    created_at: datetime = Field(default_factory=datetime.utcnow) # 作成日時 (自動設定)

# 招待コードモデル
# データベースの 'invitationcode' テーブルに対応します
class InvitationCode(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True) # 招待コード (UUIDなど)
    is_used: bool = Field(default=False) # 使用済みフラグ
    created_at: datetime = Field(default_factory=datetime.utcnow)
    used_at: Optional[datetime] = None # 使用日時
    used_by_user_id: Optional[int] = Field(default=None, foreign_key="user.id") # 誰が使ったか (Userテーブルへの外部キー)

