#!/usr/bin/env python3
"""
HX LoLi Img — 交互式一键部署脚本

功能:
  1. 检查依赖 (git, node, npm, wrangler, gh)
  2. 生成安全密钥
  3. 初始化 Git 仓库 + 推送到 GitHub
  4. 创建 R2 存储桶
  5. 配置 Cloudflare Worker 密钥
  6. 部署 Worker

用法:
  cd HX-CF-LoLi-Img
  uv run scripts/deploy.py
"""

from __future__ import annotations

import os
import secrets
import shutil
import subprocess
import sys
from pathlib import Path

# ── 颜色 ──
PINK = "\033[38;5;205m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
DIM = "\033[2m"
BOLD = "\033[1m"
RESET = "\033[0m"


def pink(s: str) -> str:
    return f"{PINK}{s}{RESET}"


def green(s: str) -> str:
    return f"{GREEN}{s}{RESET}"


def yellow(s: str) -> str:
    return f"{YELLOW}{s}{RESET}"


def red(s: str) -> str:
    return f"{RED}{s}{RESET}"


def dim(s: str) -> str:
    return f"{DIM}{s}{RESET}"


def bold(s: str) -> str:
    return f"{BOLD}{s}{RESET}"


def banner():
    print()
    print(pink("  ╔══════════════════════════════════════╗"))
    print(pink("  ║    🌸 HX LoLi Img — 一键部署 🌸     ║"))
    print(pink("  ║    二次元随机图片 API · CF R2         ║"))
    print(pink("  ╚══════════════════════════════════════╝"))
    print()


def step(n: int, total: int, msg: str):
    print(f"\n{pink(f'[{n}/{total}]')} {bold(msg)}")
    print(pink("─" * 50))


def ask(prompt: str, default: str = "") -> str:
    """交互式提问，支持默认值"""
    if default:
        display = f"{prompt} {dim(f'[{default}]')}: "
    else:
        display = f"{prompt}: "
    value = input(display).strip()
    return value or default


def ask_yes(prompt: str, default: bool = True) -> bool:
    hint = "[Y/n]" if default else "[y/N]"
    value = input(f"{prompt} {dim(hint)}: ").strip().lower()
    if not value:
        return default
    return value in ("y", "yes")


def run(cmd: str | list[str], *, check: bool = True, capture: bool = False, **kw) -> subprocess.CompletedProcess:
    """执行命令"""
    if isinstance(cmd, str):
        cmd_list = cmd.split()
    else:
        cmd_list = cmd
    print(dim(f"  $ {' '.join(cmd_list)}"))
    return subprocess.run(
        cmd_list,
        check=check,
        capture_output=capture,
        text=True,
        **kw,
    )


def check_tool(name: str, install_hint: str) -> bool:
    if shutil.which(name):
        print(f"  {green('✓')} {name}")
        return True
    print(f"  {red('✗')} {name} — {yellow(install_hint)}")
    return False


def generate_token(length: int = 32) -> str:
    return secrets.token_urlsafe(length)


def main():
    banner()

    project_root = Path(__file__).resolve().parent.parent
    os.chdir(project_root)
    print(dim(f"  工作目录: {project_root}"))

    total_steps = 6

    # ══════════════════════════════════════
    # Step 1: 检查依赖
    # ══════════════════════════════════════
    step(1, total_steps, "检查依赖工具")

    tools_ok = True
    tools_ok &= check_tool("git", "https://git-scm.com/")
    tools_ok &= check_tool("node", "https://nodejs.org/ (>=18)")
    tools_ok &= check_tool("npm", "随 node 安装")

    has_gh = check_tool("gh", "https://cli.github.com/ (可选，用于创建 GitHub 仓库)")
    has_wrangler = check_tool("npx", "随 npm 安装")

    if not tools_ok:
        print(f"\n{red('错误')}: 请先安装缺失的工具后重试。")
        sys.exit(1)

    # ══════════════════════════════════════
    # Step 2: 生成密钥
    # ══════════════════════════════════════
    step(2, total_steps, "配置密钥")

    dev_vars = project_root / ".dev.vars"
    admin_token = ""
    upload_token = ""

    if dev_vars.exists():
        print(f"  {yellow('发现')} 已有 .dev.vars 文件")
        if ask_yes("是否重新生成密钥？", default=False):
            admin_token = generate_token()
            upload_token = generate_token()
        else:
            # 从已有文件读取
            for line in dev_vars.read_text().splitlines():
                if line.startswith("ADMIN_TOKEN="):
                    admin_token = line.split("=", 1)[1].strip()
                elif line.startswith("UPLOAD_TOKEN="):
                    upload_token = line.split("=", 1)[1].strip()
            print(f"  {green('✓')} 使用已有密钥")
    else:
        admin_token = generate_token()
        upload_token = generate_token()

    if admin_token and upload_token:
        dev_vars.write_text(
            f"# 自动生成 — 不要提交到 Git！\n"
            f"ADMIN_TOKEN={admin_token}\n"
            f"UPLOAD_TOKEN={upload_token}\n"
        )
        print(f"\n  {green('Admin Token')}: {admin_token[:8]}...{dim('(已保存到 .dev.vars)')}")
        print(f"  {green('Upload Token')}: {upload_token[:8]}...{dim('(已保存到 .dev.vars)')}")
        print(f"\n  {yellow('⚠ 请记住这些 Token！')}")
        print(f"  {yellow('  Admin Token  — 用于管理后台 /admin')}")
        print(f"  {yellow('  Upload Token — 用于 Python 爬虫上传')}")

    # ══════════════════════════════════════
    # Step 3: 安装 npm 依赖
    # ══════════════════════════════════════
    step(3, total_steps, "安装 npm 依赖")

    if not (project_root / "node_modules").exists():
        run("npm install")
    else:
        print(f"  {green('✓')} node_modules 已存在，跳过")

    # ══════════════════════════════════════
    # Step 4: Git + GitHub
    # ══════════════════════════════════════
    step(4, total_steps, "Git 仓库 + GitHub")

    # 初始化 git
    if not (project_root / ".git").exists():
        run("git init")
        run(["git", "add", "."])
        run(["git", "commit", "-m", "feat: initial commit - HX LoLi Img"])
        print(f"  {green('✓')} Git 仓库已初始化")
    else:
        print(f"  {green('✓')} Git 仓库已存在")

    # GitHub
    if has_gh and ask_yes("是否创建/关联 GitHub 仓库？"):
        # 检查 gh 是否已认证
        auth_check = run("gh auth status", check=False, capture=True)
        if auth_check.returncode != 0:
            print(f"  {yellow('需要先登录 GitHub CLI')}")
            run("gh auth login")

        repo_name = ask("GitHub 仓库名", "HX-CF-LoLi-Img")
        visibility = ask("仓库可见性 (public/private)", "public")

        # 检查是否已有 remote
        remote_check = run("git remote get-url origin", check=False, capture=True)
        if remote_check.returncode == 0:
            print(f"  {yellow('已有 remote origin')}: {remote_check.stdout.strip()}")
            if ask_yes("是否覆盖？", default=False):
                run("git remote remove origin")
            else:
                print(f"  {green('✓')} 保持已有 remote")
                # 推送
                if ask_yes("推送到远程？"):
                    run(["git", "push", "-u", "origin", "master"])
                goto_step5 = True

        if not (project_root / ".git" / "refs" / "remotes" / "origin").exists() or not run(
            "git remote get-url origin", check=False, capture=True
        ).stdout.strip():
            # 创建 GitHub 仓库
            print(f"  创建 GitHub 仓库: {repo_name} ({visibility})")
            create_result = run(
                [
                    "gh", "repo", "create", repo_name,
                    f"--{visibility}",
                    "--source=.",
                    "--remote=origin",
                    "--description=二次元随机图片 API · Cloudflare R2 + Workers",
                ],
                check=False,
                capture=True,
            )
            if create_result.returncode == 0:
                print(f"  {green('✓')} GitHub 仓库已创建")
                run(["git", "push", "-u", "origin", "master"])
            else:
                print(f"  {yellow('创建失败')}: {create_result.stderr.strip()}")
                print(f"  你可以稍后手动运行: gh repo create {repo_name} --{visibility} --source=. --remote=origin")
    else:
        print(dim("  跳过 GitHub 设置"))

    # ══════════════════════════════════════
    # Step 5: Cloudflare R2 + Worker 密钥
    # ══════════════════════════════════════
    step(5, total_steps, "Cloudflare R2 存储桶 + Worker 密钥")

    print(f"  {yellow('确保你已登录 Cloudflare:')}")
    print(dim("  如果还没有登录，下面的命令会自动打开浏览器"))

    if ask_yes("是否执行 wrangler 登录？"):
        run("npx wrangler login", check=False)

    # 创建 R2 存储桶
    bucket_name = ask("R2 存储桶名称", "loli-img")
    print(f"\n  创建 R2 存储桶: {bucket_name}")
    create_bucket = run(
        ["npx", "wrangler", "r2", "bucket", "create", bucket_name],
        check=False,
        capture=True,
    )
    if create_bucket.returncode == 0:
        print(f"  {green('✓')} R2 存储桶已创建: {bucket_name}")
    elif "already exists" in (create_bucket.stderr or ""):
        print(f"  {green('✓')} R2 存储桶已存在: {bucket_name}")
    else:
        print(f"  {yellow('注意')}: {create_bucket.stderr.strip()}")

    # 更新 wrangler.toml 中的 bucket_name
    wrangler_toml = project_root / "wrangler.toml"
    content = wrangler_toml.read_text(encoding="utf-8")
    if f'bucket_name = "{bucket_name}"' not in content:
        content = content.replace('bucket_name = "loli-img"', f'bucket_name = "{bucket_name}"')
        wrangler_toml.write_text(content, encoding="utf-8")
        print(f"  {green('✓')} 已更新 wrangler.toml 中的 bucket_name")

    # 设置 Worker 密钥
    print(f"\n  配置 Worker 线上环境密钥...")
    if admin_token:
        print(dim("  设置 ADMIN_TOKEN..."))
        proc = subprocess.run(
            ["npx", "wrangler", "secret", "put", "ADMIN_TOKEN"],
            input=admin_token,
            text=True,
            capture_output=True,
        )
        if proc.returncode == 0:
            print(f"  {green('✓')} ADMIN_TOKEN 已设置")
        else:
            print(f"  {yellow('注意')}: {proc.stderr.strip()}")
            print(dim(f"  你可以稍后手动运行: echo '{admin_token}' | npx wrangler secret put ADMIN_TOKEN"))

    if upload_token:
        print(dim("  设置 UPLOAD_TOKEN..."))
        proc = subprocess.run(
            ["npx", "wrangler", "secret", "put", "UPLOAD_TOKEN"],
            input=upload_token,
            text=True,
            capture_output=True,
        )
        if proc.returncode == 0:
            print(f"  {green('✓')} UPLOAD_TOKEN 已设置")
        else:
            print(f"  {yellow('注意')}: {proc.stderr.strip()}")
            print(dim(f"  你可以稍后手动运行: echo '{upload_token}' | npx wrangler secret put UPLOAD_TOKEN"))

    # ══════════════════════════════════════
    # Step 6: 部署
    # ══════════════════════════════════════
    step(6, total_steps, "部署 Worker")

    if ask_yes("是否立即部署到 Cloudflare？"):
        run("npm run deploy")
        print(f"\n  {green('✓')} 部署完成！")
    else:
        print(dim("  跳过部署。稍后运行: npm run deploy"))

    # ══════════════════════════════════════
    # 完成
    # ══════════════════════════════════════
    print()
    print(pink("  ╔══════════════════════════════════════╗"))
    print(pink("  ║         🌸 部署完成！ 🌸              ║"))
    print(pink("  ╚══════════════════════════════════════╝"))
    print()
    print(f"  {bold('接下来:')}")
    print(f"  1. 访问你的 Worker URL 查看 API 文档")
    print(f"  2. 访问 /admin 登录管理后台")
    print(f"  3. 使用 Python SDK 上传图片:")
    print()
    print(dim("     from hx_loli_img import LoLiImgClient"))
    print(dim(f'     client = LoLiImgClient("https://your-worker.dev", "{upload_token[:8]}...")'))
    print(dim('     client.upload("image.jpg", tags=["genshin"])'))
    print()
    print(f"  {bold('密钥备忘:')}")
    print(f"  Admin Token:  {admin_token}")
    print(f"  Upload Token: {upload_token}")
    print()
    print(pink("  感谢使用 HX LoLi Img！ 🌸"))
    print()


if __name__ == "__main__":
    main()
