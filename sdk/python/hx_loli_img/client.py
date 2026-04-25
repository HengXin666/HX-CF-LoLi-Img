"""
HX LoLi Img Python SDK

用于爬虫上传图片到 CF R2 存储。
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx
from PIL import Image


class LoLiImgClient:
    """图片上传客户端。

    用法:
        client = LoLiImgClient("https://your-worker.dev", "your-upload-token")
        result = client.upload("path/to/image.jpg", tags=["genshin", "hutao"])
    """

    def __init__(self, base_url: str, token: str, *, timeout: float = 60.0):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self._http = httpx.Client(
            base_url=self.base_url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=timeout,
        )

    def upload(
        self,
        file_path: str | Path,
        *,
        tags: list[str] | None = None,
        prompt: dict | None = None,
        source: str = "",
        uploader: str = "",
        auto_dimensions: bool = True,
    ) -> dict:
        """上传单张图片。

        Args:
            file_path: 图片文件路径
            tags: 标签列表
            prompt: AI 提示词 (任意 JSON 结构)
            source: 图片来源 URL
            uploader: 上传者标识
            auto_dimensions: 是否自动读取图片尺寸

        Returns:
            API 响应的 JSON dict
        """
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {path}")

        # 自动获取图片尺寸
        width, height = 0, 0
        if auto_dimensions:
            try:
                with Image.open(path) as img:
                    width, height = img.size
            except Exception:
                pass

        data: dict[str, str] = {}
        if tags:
            data["tags"] = ",".join(tags)
        if prompt:
            data["prompt"] = json.dumps(prompt, ensure_ascii=False)
        if source:
            data["source"] = source
        if uploader:
            data["uploader"] = uploader
        if width > 0:
            data["width"] = str(width)
        if height > 0:
            data["height"] = str(height)

        with path.open("rb") as f:
            resp = self._http.post(
                "/api/upload",
                data=data,
                files={"file": (path.name, f, _guess_mime(path))},
            )

        resp.raise_for_status()
        return resp.json()

    def upload_batch(
        self,
        file_paths: list[str | Path],
        *,
        tags: list[str] | None = None,
        source: str = "",
        uploader: str = "",
    ) -> list[dict]:
        """批量上传多张图片。

        Returns:
            每张图片的上传结果列表
        """
        results = []
        for fp in file_paths:
            result = self.upload(
                fp, tags=tags, source=source, uploader=uploader
            )
            results.append(result)
        return results

    def random(
        self,
        count: int = 1,
        *,
        tags: list[str] | None = None,
        orientation: str | None = None,
        min_width: int | None = None,
        min_height: int | None = None,
    ) -> dict:
        """获取随机图片（公开 API，不需要上传 Token）。

        Args:
            count: 返回数量 (1-20)
            tags: 标签筛选
            orientation: landscape / portrait / square
            min_width: 最小宽度
            min_height: 最小高度

        Returns:
            API 响应 JSON
        """
        params: dict[str, str | list[str]] = {"count": str(count)}
        if tags:
            params["tag"] = tags
        if orientation:
            params["orientation"] = orientation
        if min_width:
            params["min_width"] = str(min_width)
        if min_height:
            params["min_height"] = str(min_height)

        resp = self._http.get("/api/random", params=params)
        resp.raise_for_status()
        return resp.json()

    def close(self):
        self._http.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def _guess_mime(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".avif": "image/avif",
    }.get(ext, "application/octet-stream")
