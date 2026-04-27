#!/usr/bin/env python3
"""
HX LoLi Img - 交互式一键部署脚本（幂等，可重复运行）

用法:
  cd HX-CF-LoLi-Img
  uv run scripts/deploy.py
"""

from __future__ import annotations

import io
import os
import re
import secrets
import shutil
import subprocess
import sys
from pathlib import Path

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

if sys.platform == "win32":
    os.system("")

PINK = "\033[38;5;205m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
DIM = "\033[2m"
BOLD = "\033[1m"
RESET = "\033[0m"

TOTAL_STEPS = 9


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
    print(pink("  +==========================================+"))
    print(pink("  |    * HX LoLi Img -- Full Deploy *        |"))
    print(pink("  |    ACG Random Image API - CF R2 + D1     |"))
    print(pink("  |    Idempotent - safe to re-run anytime   |"))
    print(pink("  +==========================================+"))
    print()


def step(n: int, msg: str):
    print(f"\n{pink(f'[{n}/{TOTAL_STEPS}]')} {bold(msg)}")
    print(pink("-" * 50))


def ask(prompt: str, default: str = "") -> str:
    if default:
        display = f"{prompt} {dim(f'[{default}]')}: "
    else:
        display = f"{prompt}: "
    try:
        value = input(display).strip()
    except (EOFError, KeyboardInterrupt):
        print(default)
        return default
    return value or default


def ask_yes(prompt: str, default: bool = True) -> bool:
    hint = "[Y/n]" if default else "[y/N]"
    try:
        value = input(f"{prompt} {dim(hint)}: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        answer = "Y" if default else "N"
        print(answer)
        return default
    if not value:
        return default
    return value in ("y", "yes")


def run(
    cmd: str | list[str],
    *,
    check: bool = True,
    capture: bool = False,
    input_text: str | None = None,
) -> subprocess.CompletedProcess:
    """跨平台执行命令。Windows 上始终 shell=True + encoding=utf-8。"""
    if isinstance(cmd, list):
        cmd_str = subprocess.list2cmdline(cmd)
    else:
        cmd_str = cmd

    print(dim(f"  $ {cmd_str}"))

    kwargs: dict = {
        "check": check,
        "text": True,
        "shell": True,
        "encoding": "utf-8",
        "errors": "replace",
    }
    if capture:
        kwargs["capture_output"] = True
    if input_text is not None:
        kwargs["input"] = input_text
        if not capture:
            kwargs["capture_output"] = True

    return subprocess.run(cmd_str, **kwargs)


def check_tool(name: str, install_hint: str) -> bool:
    if shutil.which(name):
        print(f"  {green('[ok]')} {name}")
        return True
    print(f"  {red('[missing]')} {name} -- {yellow(install_hint)}")
    return False


def generate_token(length: int = 32) -> str:
    return secrets.token_urlsafe(length)


def normalize_bucket_name(name: str) -> str:
    """R2 bucket 名称规则: 全小写字母/数字/连字符, 3-63 字符, 首尾字母数字"""
    name = name.lower().strip()
    name = re.sub(r"[^a-z0-9-]", "-", name)
    name = re.sub(r"-+", "-", name)
    name = name.strip("-")
    if len(name) < 3:
        name = name.ljust(3, "0")
    if len(name) > 63:
        name = name[:63].rstrip("-")
    return name


def read_dev_vars(dev_vars: Path) -> dict[str, str]:
    """读取 .dev.vars 文件，兼容 UTF-8 和 GBK 编码。"""
    result: dict[str, str] = {}
    if not dev_vars.exists():
        return result
    raw = dev_vars.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("gbk", errors="replace")
    for line in text.splitlines():
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            key, _, val = line.partition("=")
            result[key.strip()] = val.strip()
    return result


def extract_worker_url(output: str) -> str:
    """从 wrangler deploy 输出中提取 Worker URL。"""
    patterns = [
        r"(https://[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev)",
        r"Published\s+.*?(https://\S+)",
        r"(https://\S+\.workers\.dev)",
    ]
    for pattern in patterns:
        m = re.search(pattern, output, re.IGNORECASE)
        if m:
            return m.group(1).rstrip("/")
    return ""


def get_current_worker_url() -> str:
    """尝试通过 wrangler 获取当前已部署的 Worker URL。"""
    result = run("npx wrangler deployments list --limit 1", check=False, capture=True)
    combined = (result.stdout or "") + (result.stderr or "")
    url = extract_worker_url(combined)
    if url:
        return url
    # 回退：从 wrangler.toml 读取 worker 名称拼接默认 URL
    return ""


def step_check_deps() -> bool:
    """Step 1: 检查依赖工具"""
    step(1, "Check dependencies")

    tools_ok = True
    tools_ok &= check_tool("git", "https://git-scm.com/")
    tools_ok &= check_tool("node", "https://nodejs.org/ (>=18)")
    tools_ok &= check_tool("npm", "comes with node")

    has_gh = check_tool("gh", "https://cli.github.com/ (optional)")
    check_tool("npx", "comes with npm")

    if not tools_ok:
        print(f"\n{red('Error')}: Install missing tools first.")
        sys.exit(1)

    return has_gh


def step_secrets(project_root: Path) -> tuple[str, str]:
    """Step 2: 配置密钥（幂等：已有则复用）"""
    step(2, "Configure secrets")

    dev_vars = project_root / ".dev.vars"
    existing = read_dev_vars(dev_vars)
    admin_token = existing.get("ADMIN_TOKEN", "")
    upload_token = existing.get("UPLOAD_TOKEN", "")

    if admin_token and upload_token:
        print(f"  {green('[ok]')} Secrets already configured in .dev.vars")
        print(f"  Admin Token:  {admin_token[:12]}...")
        print(f"  Upload Token: {upload_token[:12]}...")
        if ask_yes("Regenerate secrets?", default=False):
            admin_token = generate_token()
            upload_token = generate_token()
        else:
            return admin_token, upload_token

    if not admin_token:
        admin_token = generate_token()
    if not upload_token:
        upload_token = generate_token()

    dev_vars.write_text(
        f"# Auto-generated -- DO NOT commit to Git!\n"
        f"ADMIN_TOKEN={admin_token}\n"
        f"UPLOAD_TOKEN={upload_token}\n",
        encoding="utf-8",
    )
    print(
        f"\n  {green('Admin Token')}:  {admin_token[:12]}... {dim('(saved to .dev.vars)')}"
    )
    print(
        f"  {green('Upload Token')}: {upload_token[:12]}... {dim('(saved to .dev.vars)')}"
    )
    print(f"\n  {yellow('!! Remember these tokens !!')}")
    print(f"  {yellow('  Admin Token  -> /admin dashboard')}")
    print(f"  {yellow('  Upload Token -> Python uploader')}")

    return admin_token, upload_token


def step_npm(project_root: Path):
    """Step 3: 安装 npm 依赖（幂等：已有则跳过）"""
    step(3, "Install npm dependencies")

    if (project_root / "node_modules").exists():
        print(f"  {green('[ok]')} node_modules exists, skip")
    else:
        run("npm install")


def step_git_github(project_root: Path, has_gh: bool):
    """Step 4: Git + GitHub（幂等：已初始化则跳过）"""
    step(4, "Git + GitHub")

    if not (project_root / ".git").exists():
        run("git init")
        run("git add .")
        run('git commit -m "feat: initial commit - HX LoLi Img"')
        print(f"  {green('[ok]')} Git repo initialized")
    else:
        print(f"  {green('[ok]')} Git repo already exists")

    if has_gh and ask_yes("Create/link GitHub repo?"):
        auth_check = run("gh auth status", check=False, capture=True)
        if auth_check.returncode != 0:
            print(f"  {yellow('GitHub CLI not authenticated, logging in...')}")
            run("gh auth login")

        repo_name = ask("GitHub repo name", "HX-CF-LoLi-Img")
        visibility = ask("Visibility (public/private)", "public")

        remote_check = run("git remote get-url origin", check=False, capture=True)
        has_origin = remote_check.returncode == 0

        if has_origin:
            print(
                f"  {yellow('Existing remote origin')}: {remote_check.stdout.strip()}"
            )
            if ask_yes("Override?", default=False):
                run("git remote remove origin")
                has_origin = False
            else:
                print(f"  {green('[ok]')} Keeping existing remote")
                if ask_yes("Push to remote?"):
                    run("git push -u origin master", check=False)

        if not has_origin:
            print(f"  Creating GitHub repo: {repo_name} ({visibility})")
            desc = "ACG Random Image API - Cloudflare R2 + Workers"
            result = run(
                f'gh repo create {repo_name} --{visibility} --source=. --remote=origin --description="{desc}"',
                check=False,
                capture=True,
            )
            if result.returncode == 0:
                print(f"  {green('[ok]')} GitHub repo created")
                run("git push -u origin master", check=False)
            else:
                stderr = result.stderr.strip() if result.stderr else "unknown error"
                print(f"  {yellow('Failed')}: {stderr}")
                print(
                    dim(
                        f"  Manual: gh repo create {repo_name} --{visibility} --source=. --remote=origin"
                    )
                )
    else:
        print(dim("  Skipping GitHub setup"))


def step_cloudflare(project_root: Path, admin_token: str, upload_token: str) -> str:
    """Step 5: Cloudflare R2 + Worker secrets（幂等：bucket 已存在则跳过）
    返回 bucket_name。
    """
    step(5, "Cloudflare R2 + Worker secrets")

    print(f"  {yellow('Make sure you are logged in to Cloudflare.')}")
    print(dim("  If not, the next command will open a browser."))

    whoami = run("npx wrangler whoami", check=False, capture=True)
    if whoami.returncode != 0 or "not authenticated" in (whoami.stderr or "").lower():
        print(f"  {yellow('Not logged in, opening browser...')}")
        run("npx wrangler login", check=False)
    else:
        print(f"  {green('[ok]')} Already logged in to Cloudflare")

    # 读取 wrangler.toml 中当前的 bucket_name 作为默认值
    wrangler_toml = project_root / "wrangler.toml"
    toml_content = wrangler_toml.read_text(encoding="utf-8")
    current_bucket = "loli-img"
    m = re.search(r'bucket_name\s*=\s*"([^"]*)"', toml_content)
    if m:
        current_bucket = m.group(1)

    raw_bucket = ask("R2 bucket name", current_bucket)
    bucket_name = normalize_bucket_name(raw_bucket)
    if bucket_name != raw_bucket:
        print(
            f"  {yellow('Auto-corrected')}: {dim(raw_bucket)} -> {green(bucket_name)}"
        )
        print(dim("  (R2 requires: lowercase, numbers, hyphens, 3-63 chars)"))

    print(f"\n  Creating R2 bucket: {bucket_name}")
    bucket_result = run(
        f"npx wrangler r2 bucket create {bucket_name}",
        check=False,
        capture=True,
    )
    stdout_out = bucket_result.stdout or ""
    stderr_out = bucket_result.stderr or ""
    combined = stdout_out + stderr_out

    if bucket_result.returncode == 0:
        print(f"  {green('[ok]')} R2 bucket created: {bucket_name}")
    elif "already exists" in combined.lower():
        print(f"  {green('[ok]')} R2 bucket already exists: {bucket_name}")
    else:
        print(f"  {yellow('Note')}: {stderr_out.strip()}")

    # 更新 wrangler.toml bucket_name（幂等：相同值则跳过）
    new_line = f'bucket_name = "{bucket_name}"'
    if new_line not in toml_content:
        toml_content = re.sub(
            r'bucket_name\s*=\s*"[^"]*"',
            new_line,
            toml_content,
            count=1,
        )
        wrangler_toml.write_text(toml_content, encoding="utf-8")
        print(f"  {green('[ok]')} Updated wrangler.toml: {new_line}")
    else:
        print(f"  {green('[ok]')} wrangler.toml already up to date")

    # 设置 Worker secrets（幂等：wrangler secret put 是覆盖式的）
    print(f"\n  Setting Worker production secrets...")
    for name, value in [("ADMIN_TOKEN", admin_token), ("UPLOAD_TOKEN", upload_token)]:
        if not value:
            continue
        print(dim(f"  Setting {name}..."))
        result = run(
            f"npx wrangler secret put {name}",
            check=False,
            capture=True,
            input_text=value,
        )
        if result.returncode == 0:
            print(f"  {green('[ok]')} {name} set")
        else:
            stderr = result.stderr.strip() if result.stderr else ""
            print(f"  {yellow('Note')}: {stderr}")
            print(dim(f"  Manual: npx wrangler secret put {name}"))

    return bucket_name


def step_d1(project_root: Path) -> str:
    """Step 6: 创建 D1 数据库（幂等：已存在则跳过）
    返回 database_id。
    """
    step(6, "Cloudflare D1 database")

    wrangler_toml = project_root / "wrangler.toml"
    toml_content = wrangler_toml.read_text(encoding="utf-8")

    # 检查 wrangler.toml 中是否已有有效的 database_id
    m = re.search(r'database_id\s*=\s*"([a-f0-9-]{36})"', toml_content)
    if m:
        db_id = m.group(1)
        print(f"  {green('[ok]')} D1 database_id already configured: {db_id[:12]}...")
        return db_id

    # 读取当前 database_name
    db_name = "loli-img-db"
    m_name = re.search(r'database_name\s*=\s*"([^"]+)"', toml_content)
    if m_name:
        db_name = m_name.group(1)

    db_name = ask("D1 database name", db_name)

    # 尝试列出已有数据库
    print(f"\n  Checking existing D1 databases...")
    list_result = run("npx wrangler d1 list", check=False, capture=True)
    list_output = (list_result.stdout or "") + (list_result.stderr or "")

    # 尝试从列表中找到同名数据库的 ID
    db_id = ""
    for line in list_output.splitlines():
        if db_name in line:
            id_match = re.search(
                r"([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})", line
            )
            if id_match:
                db_id = id_match.group(1)
                print(
                    f"  {green('[ok]')} Found existing D1 database: {db_name} ({db_id[:12]}...)"
                )
                break

    if not db_id:
        print(f"  Creating D1 database: {db_name}")
        create_result = run(
            f"npx wrangler d1 create {db_name}",
            check=False,
            capture=True,
        )
        create_output = (create_result.stdout or "") + (create_result.stderr or "")

        # 从输出中提取 database_id
        id_match = re.search(
            r"([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})",
            create_output,
        )
        if id_match:
            db_id = id_match.group(1)
            print(f"  {green('[ok]')} D1 database created: {db_name}")
            print(f"  Database ID: {db_id}")
        elif "already exists" in create_output.lower():
            print(f"  {yellow('Database already exists, trying to find ID...')}")
            # 重新列出
            list2 = run("npx wrangler d1 list", check=False, capture=True)
            for line in (list2.stdout or "").splitlines():
                if db_name in line:
                    id_match = re.search(
                        r"([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})",
                        line,
                    )
                    if id_match:
                        db_id = id_match.group(1)
                        break
        else:
            print(f"  {red('Failed to create D1 database')}")
            if create_result.stderr:
                print(f"  {create_result.stderr.strip()}")

    if not db_id:
        print(f"  {yellow('Could not determine database_id')}")
        db_id = ask("Enter D1 database_id manually")
        if not db_id:
            print(f"  {red('No database_id, D1 will not work!')}")
            return ""

    # 更新 wrangler.toml 中的 database_id
    old_id_line = re.search(r'database_id\s*=\s*"[^"]*"', toml_content)
    if old_id_line:
        new_content = toml_content.replace(
            old_id_line.group(0),
            f'database_id = "{db_id}"',
        )
        wrangler_toml.write_text(new_content, encoding="utf-8")
        print(f"  {green('[ok]')} Updated wrangler.toml: database_id = {db_id[:12]}...")
    else:
        print(f"  {yellow('database_id field not found in wrangler.toml')}")
        print(dim(f'  Please add manually: database_id = "{db_id}"'))

    return db_id


def step_deploy() -> str:
    """Step 6: 部署 Worker，返回 Worker URL。"""
    step(7, "Deploy Worker")

    worker_url = ""

    if ask_yes("Deploy to Cloudflare now?"):
        result = run("npx wrangler deploy", check=False, capture=True)
        combined = (result.stdout or "") + (result.stderr or "")
        # 打印 wrangler 输出
        if result.stdout:
            for line in result.stdout.strip().splitlines():
                print(f"  {line}")
        if result.stderr:
            for line in result.stderr.strip().splitlines():
                print(f"  {dim(line)}")

        if result.returncode == 0:
            worker_url = extract_worker_url(combined)
            print(f"\n  {green('[ok]')} Deployed!")
            if worker_url:
                print(f"  {green('Worker URL')}: {bold(worker_url)}")
        else:
            print(f"\n  {red('Deploy failed!')} Exit code: {result.returncode}")
            print(
                f"  {yellow('Fix the errors above, then run manually')}: npm run deploy"
            )
    else:
        print(dim("  Skipped. Run later: npm run deploy"))

    return worker_url


def step_custom_domain(project_root: Path, worker_url: str):
    """Step 7: 自定义域名配置（可选）"""
    step(8, "Custom domain (optional)")

    print(f"  Custom domain lets you use your own domain instead of *.workers.dev")
    print(
        f"  {dim('Prerequisite: domain must be hosted on Cloudflare (DNS managed by CF)')}"
    )
    print()

    if not ask_yes("Configure custom domain?", default=False):
        print(dim("  Skipped. You can configure later in Cloudflare Dashboard:"))
        print(dim("  Workers & Pages -> hx-loli-img -> Settings -> Domains & Routes"))
        return

    custom_domain = ask("Enter your custom domain (e.g. img.yourdomain.com)")
    if not custom_domain:
        print(dim("  No domain entered, skipping"))
        return

    # 验证域名格式
    custom_domain = custom_domain.strip().lower()
    if not re.match(
        r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$",
        custom_domain,
    ):
        print(f"  {red('Invalid domain format')}: {custom_domain}")
        return

    # 读取 wrangler.toml，检查是否已配置
    wrangler_toml = project_root / "wrangler.toml"
    toml_content = wrangler_toml.read_text(encoding="utf-8")

    route_line = f'pattern = "{custom_domain}/*"'
    if route_line in toml_content:
        print(f"  {green('[ok]')} Custom domain already configured: {custom_domain}")
        return

    # 获取 zone_name（顶级域名）
    parts = custom_domain.split(".")
    if len(parts) >= 2:
        zone_name = ".".join(parts[-2:])
    else:
        zone_name = custom_domain

    zone_input = ask(f"Zone name (your root domain)", zone_name)

    # 追加 routes 配置到 wrangler.toml
    route_block = (
        f"\n# 自定义域名\n"
        f"routes = [\n"
        f'  {{ pattern = "{custom_domain}/*", zone_name = "{zone_input}" }}\n'
        f"]\n"
    )

    # 检查是否已有 routes 配置
    if "routes" in toml_content and "pattern" in toml_content:
        print(f"  {yellow('wrangler.toml already has routes config')}")
        print(f"  Please manually add your domain to the existing routes array")
        print(dim(f'  {{ pattern = "{custom_domain}/*", zone_name = "{zone_input}" }}'))
    else:
        toml_content += route_block
        wrangler_toml.write_text(toml_content, encoding="utf-8")
        print(f"  {green('[ok]')} Added route to wrangler.toml: {custom_domain}")

    print()
    print(
        f"  {yellow('Important')}: Make sure your domain DNS is managed by Cloudflare"
    )
    print(f"  {dim('CF will auto-create DNS record and issue SSL certificate')}")

    # 重新部署以应用域名配置
    if ask_yes("Re-deploy to apply custom domain?"):
        result = run("npx wrangler deploy", check=False, capture=True)
        if result.returncode == 0:
            print(f"  {green('[ok]')} Re-deployed with custom domain!")
            print(f"  {green('Your API')}: https://{custom_domain}")
        else:
            print(f"  {yellow('Deploy failed, run manually')}: npm run deploy")


def step_github_actions(project_root: Path, has_gh: bool):
    """Step 8: 配置 GitHub Actions CI/CD（幂等：已有则跳过）"""
    step(9, "GitHub Actions CI/CD")

    workflow_file = project_root / ".github" / "workflows" / "deploy.yml"

    if workflow_file.exists():
        print(f"  {green('[ok]')} GitHub Actions workflow already exists")
        print(dim(f"  {workflow_file.relative_to(project_root)}"))
    else:
        print(f"  {yellow('No workflow found')}")
        print(dim("  Workflow file should be at .github/workflows/deploy.yml"))
        return

    print()
    print(f"  {bold('To enable auto-deploy on push, you need to:')}")
    print(f"  1. Create a Cloudflare API Token with 'Edit Workers' permission")
    print(f"     {dim('https://dash.cloudflare.com/profile/api-tokens')}")
    print(f"  2. Add it as a GitHub repo secret named {bold('CLOUDFLARE_API_TOKEN')}")
    print()

    if not has_gh:
        print(dim("  gh CLI not available, please add the secret manually on GitHub"))
        print(
            dim(
                "  Repo -> Settings -> Secrets and variables -> Actions -> New repository secret"
            )
        )
        return

    if not ask_yes("Set up CLOUDFLARE_API_TOKEN secret now?", default=False):
        print(dim("  Skipped. Add it later in GitHub repo Settings -> Secrets"))
        return

    # 检查是否有 remote
    remote_check = run("git remote get-url origin", check=False, capture=True)
    if remote_check.returncode != 0:
        print(f"  {yellow('No git remote origin found')}")
        print(dim("  Push to GitHub first, then add the secret manually"))
        return

    cf_token = ask("Paste your Cloudflare API Token (Edit Workers permission)")
    if not cf_token:
        print(dim("  No token entered, skipping"))
        return

    result = run(
        f"gh secret set CLOUDFLARE_API_TOKEN",
        check=False,
        capture=True,
        input_text=cf_token,
    )
    if result.returncode == 0:
        print(f"  {green('[ok]')} CLOUDFLARE_API_TOKEN secret set!")
        print(
            f"  {green('Auto-deploy is now active')}: push to main/master -> auto deploy"
        )
    else:
        stderr = result.stderr.strip() if result.stderr else ""
        print(f"  {yellow('Failed')}: {stderr}")
        print(
            dim(
                "  Add manually: GitHub repo -> Settings -> Secrets -> CLOUDFLARE_API_TOKEN"
            )
        )


def print_summary(
    worker_url: str, admin_token: str, upload_token: str, project_root: Path
):
    """打印部署完成后的完整指引。"""
    print()
    print(pink("  +==========================================+"))
    print(pink("  |         * Deploy Complete! *              |"))
    print(pink("  +==========================================+"))
    print()

    # 尝试获取 Worker URL
    if not worker_url:
        # 从 wrangler.toml 读取 worker name 拼接默认 URL
        wrangler_toml = project_root / "wrangler.toml"
        if wrangler_toml.exists():
            content = wrangler_toml.read_text(encoding="utf-8")
            m = re.search(r'^name\s*=\s*"([^"]+)"', content, re.MULTILINE)
            if m:
                worker_url = f"https://{m.group(1)}.<your-subdomain>.workers.dev"

    # 检查是否有自定义域名
    custom_domain = ""
    wrangler_toml = project_root / "wrangler.toml"
    if wrangler_toml.exists():
        content = wrangler_toml.read_text(encoding="utf-8")
        m = re.search(r'pattern\s*=\s*"([^"]+)/\*"', content)
        if m:
            custom_domain = m.group(1)

    base_url = f"https://{custom_domain}" if custom_domain else worker_url

    print(f"  {bold('Your endpoints:')}")
    print(
        f"  {green('Worker URL')}:    {bold(worker_url or '(run npm run deploy to get URL)')}"
    )
    if custom_domain:
        print(f"  {green('Custom Domain')}: {bold(f'https://{custom_domain}')}")
    print()

    print(f"  {bold('Quick links:')}")
    print(f"  API Docs:      {base_url}/")
    print(f"  Admin Panel:   {base_url}/admin")
    print(f"  Random Image:  {base_url}/api/random")
    print(f"  Random (tag):  {base_url}/api/random?tag=genshin")
    print()

    print(f"  {bold('Secrets (save these!):')}")
    print(f"  Admin Token:   {admin_token}")
    print(f"  Upload Token:  {upload_token}")
    print()

    print(f"  {bold('Upload images with Python SDK:')}")
    print(dim("  cd sdk/python && uv sync"))
    print()
    print(dim("    from hx_loli_img import LoLiImgClient"))
    print(dim(f'    client = LoLiImgClient("{base_url}", "{upload_token[:8]}...")'))
    print(dim('    client.upload("image.jpg", tags=["genshin", "hutao"])'))
    print()

    print(f"  {bold('CI/CD:')}")
    workflow = project_root / ".github" / "workflows" / "deploy.yml"
    if workflow.exists():
        print(f"  {green('[ok]')} GitHub Actions workflow configured")
        print(f"  Push to main/master branch -> auto deploy to Cloudflare")
    else:
        print(f"  {yellow('Not configured')} - run this script again to set up")
    print()

    print(f"  {bold('Useful commands:')}")
    print(dim("  npm run dev      # 本地开发"))
    print(dim("  npm run deploy   # 手动部署"))
    print(dim("  npm run tail     # 查看实时日志"))
    print()


def main():
    banner()

    project_root = Path(__file__).resolve().parent.parent
    os.chdir(project_root)
    print(dim(f"  Working dir: {project_root}"))

    # Step 1: 检查依赖
    has_gh = step_check_deps()

    # Step 2: 配置密钥
    admin_token, upload_token = step_secrets(project_root)

    # Step 3: 安装 npm 依赖
    step_npm(project_root)

    # Step 4: Git + GitHub
    step_git_github(project_root, has_gh)

    # Step 5: Cloudflare R2 + Worker secrets
    step_cloudflare(project_root, admin_token, upload_token)

    # Step 6: D1 数据库
    step_d1(project_root)

    # Step 7: 部署 Worker
    worker_url = step_deploy()

    # Step 7.5: 部署后初始化 D1 表结构
    if worker_url and admin_token:
        print(f"\n  Initializing D1 database tables...")
        init_result = run(
            f'npx wrangler d1 execute loli-img-db --command "SELECT 1"',
            check=False,
            capture=True,
        )
        # 通过 Worker API 初始化更可靠（使用 initDB）
        import urllib.request
        import urllib.error

        try:
            req = urllib.request.Request(
                f"{worker_url}/api/admin/init-db",
                method="POST",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                print(f"  {green('[ok]')} D1 tables initialized")
        except urllib.error.HTTPError as e:
            print(f"  {yellow('Init DB via API failed')}: HTTP {e.code}")
            print(dim(f"  You can init manually: POST {worker_url}/api/admin/init-db"))
        except Exception as e:
            print(f"  {yellow('Init DB via API failed')}: {e}")
            print(dim(f"  You can init manually: POST {worker_url}/api/admin/init-db"))

    # Step 8: 自定义域名
    step_custom_domain(project_root, worker_url)

    # Step 9: GitHub Actions CI/CD
    step_github_actions(project_root, has_gh)

    # 完成总结
    print_summary(worker_url, admin_token, upload_token, project_root)


if __name__ == "__main__":
    main()
