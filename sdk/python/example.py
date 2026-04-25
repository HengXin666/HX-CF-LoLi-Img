"""
HX LoLi Img 使用示例

使用前:
    cd sdk/python
    uv sync
    uv run example.py
"""

from hx_loli_img import LoLiImgClient


def main():
    # 配置你的 Worker URL 和上传 Token
    BASE_URL = "https://your-worker.your-domain.com"
    UPLOAD_TOKEN = "your-upload-token"

    with LoLiImgClient(BASE_URL, UPLOAD_TOKEN) as client:
        # === 上传图片 ===
        result = client.upload(
            "path/to/image.jpg",
            tags=["genshin", "hutao", "cute"],
            prompt={
                "positive": "1girl, hutao, genshin impact, solo, smile",
                "negative": "lowres, bad anatomy",
                "model": "animagine-xl-3.0",
                "steps": 28,
                "cfg_scale": 7,
                "sampler": "Euler a",
                "seed": 12345,
            },
            source="https://pixiv.net/artworks/12345678",
            uploader="my-crawler",
        )
        print("上传成功:", result)

        # === 获取随机图片 ===
        random_result = client.random(
            count=5,
            tags=["genshin"],
            orientation="landscape",
        )
        for img in random_result["images"]:
            print(f"随机图片: {img['url']}  标签: {img['tags']}")


if __name__ == "__main__":
    main()
