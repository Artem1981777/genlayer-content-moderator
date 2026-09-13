# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *


@contract
class Storage:
    value: str

    def __init__(self) -> None:
        self.value = "v1"

    @public
    def set(self, v: str) -> None:
        self.value = v

    @public
    def get(self) -> str:
        return self.value
