"""
glm_bypass — 本地点选验证码识别 HTTP 服务

核心策略:
  1. 目标检测: ddddocr det 模型定位所有汉字区域
  2. OCR 集成: 同一区域用 5 种预处理分别 OCR，投票取最佳
  3. HOG 特征匹配: 用系统中文字体渲染提示字 → 多尺寸多角度变体 → 余弦相似度
  4. 全排列搜索: 暴力搜索最优分配方案(带距离约束)
  5. 双引擎融合: OCR 投票 + HOG 图像相似度综合评分

接口:
  POST /click
    Body: {"image": "<base64>", "remark": "大中小"}
    Response: {"success": true, "data": {"result": "x1,y1|x2,y2|x3,y3"}}

  GET /health
    Response: {"status": "ok", "engine": "ddddocr", "fonts": N}
"""

import base64
import io
import logging
import os
import sys
import time
import glob
from collections import Counter
from itertools import permutations
from threading import Lock

import cv2
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image, ImageDraw, ImageFont

import ddddocr

# ═══════════════════════════════════════════════════════════════════
# Flask 应用
# ═══════════════════════════════════════════════════════════════════
app = Flask(__name__)
CORS(app)  # 允许油猴脚本跨域调用

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger('captcha-server')

# ═══════════════════════════════════════════════════════════════════
# 模型加载（全局单例）
# ═══════════════════════════════════════════════════════════════════
log.info('正在加载 ddddocr 模型...')
_det = ddddocr.DdddOcr(det=True, ocr=False, show_ad=False)
_ocr = ddddocr.DdddOcr(det=False, ocr=True, show_ad=False)
_model_lock = Lock()
log.info('模型加载完成')

# ═══════════════════════════════════════════════════════════════════
# 中文字体扫描（Windows / macOS / Linux 全平台）
# ═══════════════════════════════════════════════════════════════════
_CHINESE_FONT_PATTERNS = [
    # Windows
    'simhei', 'simsun', 'simkai', 'msyh', 'msyhbd', 'dengxian',
    'fangsong', 'stxihei', 'stsong', 'stkaiti', 'stfangsong',
    'stzhongsong', 'fzshuti', 'fzyaoti', 'youyuan', 'lishu',
    # macOS
    'PingFang', 'STHeiti', 'Songti', 'Hiragino Sans GB',
    'Kaiti', 'Baoli', 'Hanzipen', 'Lantinghei', 'Libian',
    'Weibei', 'Wawati', 'Xingkai', 'Yuanti', 'Yuppy',
    'Heiti', 'Fangsong', 'Arial Unicode',
    # Linux
    'wqy', 'noto', 'droid', 'wenquanyi',
]

_all_font_paths = []


def _scan_fonts():
    """启动时扫描系统中文字体，验证能正确渲染中文"""
    font_dirs = []

    if sys.platform == 'win32':
        windir = os.environ.get('WINDIR', r'C:\Windows')
        font_dirs.append(os.path.join(windir, 'Fonts'))
        local_fonts = os.path.join(
            os.environ.get('LOCALAPPDATA', ''), 
            'Microsoft', 'Windows', 'Fonts'
        )
        if os.path.isdir(local_fonts):
            font_dirs.append(local_fonts)
    elif sys.platform == 'darwin':
        font_dirs.extend([
            '/System/Library/Fonts',
            '/Library/Fonts',
            os.path.expanduser('~/Library/Fonts'),
        ])
    else:
        font_dirs.extend([
            '/usr/share/fonts',
            '/usr/local/share/fonts',
            os.path.expanduser('~/.local/share/fonts'),
            os.path.expanduser('~/.fonts'),
        ])

    all_paths = []
    for d in font_dirs:
        if not os.path.isdir(d):
            continue
        for ext in ('*.ttf', '*.ttc', '*.otf', '*.TTC', '*.TTF', '*.OTF'):
            all_paths.extend(glob.glob(os.path.join(d, '**', ext), recursive=True))

    # 白名单过滤
    candidates = [
        p for p in all_paths
        if any(pat.lower() in os.path.basename(p).lower() for pat in _CHINESE_FONT_PATTERNS)
    ]

    # 如果白名单为空，尝试所有字体
    if not candidates:
        candidates = all_paths[:50]  # 最多尝试50个

    seen = set()
    for path in candidates:
        if path in seen:
            continue
        for idx in range(8):
            try:
                font = ImageFont.truetype(path, 40, index=idx)
            except Exception:
                break
            try:
                cn_bb = font.getbbox('测')
                en_bb = font.getbbox('A')
                cn_w = cn_bb[2] - cn_bb[0]
                en_w = en_bb[2] - en_bb[0]
            except Exception:
                continue
            # 中文字宽度应明显大于拉丁字
            if cn_w >= 20 and cn_w >= en_w * 1.2:
                _all_font_paths.append((path, idx))
                seen.add(path)
                break

    log.info(f'扫描到 {len(_all_font_paths)} 个中文字体')

    # 如果一个都没找到，用 PIL 默认字体做兜底
    if not _all_font_paths:
        log.warning('未找到中文字体，HOG匹配将降级为纯OCR模式')


_scan_fonts()

# ═══════════════════════════════════════════════════════════════════
# HOG 特征提取
# ═══════════════════════════════════════════════════════════════════
FEAT_SIZE = 32
_font_obj_cache = {}
_variant_cache = {}

# 全局 HOG: 32×32 → 324 维
_HOG_GLOBAL = cv2.HOGDescriptor(
    _winSize=(FEAT_SIZE, FEAT_SIZE),
    _blockSize=(16, 16),
    _blockStride=(8, 8),
    _cellSize=(8, 8),
    _nbins=9,
)

_HALF = FEAT_SIZE // 2
_HOG_QUAD = cv2.HOGDescriptor(
    _winSize=(_HALF, _HALF),
    _blockSize=(8, 8),
    _blockStride=(8, 8),
    _cellSize=(4, 4),
    _nbins=9,
)


def _to_hog(arr_norm):
    """全局 HOG + 四象限 HOG 拼接 → 高维特征向量"""
    img2d = (arr_norm.reshape(FEAT_SIZE, FEAT_SIZE) * 255).astype(np.uint8)
    feat = _HOG_GLOBAL.compute(img2d).flatten()
    for y1, y2, x1, x2 in [
        (0, _HALF, 0, _HALF),
        (0, _HALF, _HALF, FEAT_SIZE),
        (_HALF, FEAT_SIZE, 0, _HALF),
        (_HALF, FEAT_SIZE, _HALF, FEAT_SIZE),
    ]:
        quad = _HOG_QUAD.compute(img2d[y1:y2, x1:x2])
        if quad is not None:
            feat = np.concatenate([feat, quad.flatten()])
    return feat


def _get_font(path, idx, size):
    key = (path, idx, size)
    if key not in _font_obj_cache:
        try:
            _font_obj_cache[key] = ImageFont.truetype(path, size, index=idx)
        except Exception:
            return None
    return _font_obj_cache[key]


def _render_variants(char):
    """渲染单个汉字的所有变体（多字体 × 多尺寸 × 多角度），结果全局缓存"""
    if char in _variant_cache:
        return _variant_cache[char]

    variants = []
    for size in [28, 34, 40]:
        for path, idx in _all_font_paths:
            font = _get_font(path, idx, size)
            if not font:
                continue
            for angle in [-20, -10, 0, 10, 20]:
                canvas = size + 30
                img = Image.new('L', (canvas, canvas), 0)
                draw = ImageDraw.Draw(img)
                draw.text((15, 10), char, fill=255, font=font)
                bbox = img.getbbox()
                if bbox:
                    img = img.crop(bbox)
                if angle != 0:
                    img = img.rotate(angle, fillcolor=0, expand=False)
                img = img.resize((FEAT_SIZE, FEAT_SIZE), Image.LANCZOS)
                arr = np.array(img, dtype=np.float32) / 255.0
                variants.append(_to_hog(arr.flatten()))

    _variant_cache[char] = variants
    log.info(f'渲染 "{char}": {len(variants)} 个变体')
    return variants


# ═══════════════════════════════════════════════════════════════════
# 图像预处理 & OCR 集成
# ═══════════════════════════════════════════════════════════════════
def _crop_image(img: Image.Image, box: list) -> tuple[bytes, Image.Image]:
    """裁剪区域，返回 (bytes, PIL Image) 避免 caller 重复解码"""
    x1, y1, x2, y2 = box
    pad = 3
    x1, y1 = max(0, x1 - pad), max(0, y1 - pad)
    x2, y2 = min(img.width, x2 + pad), min(img.height, y2 + pad)
    cropped = img.crop((x1, y1, x2, y2))
    buf = io.BytesIO()
    cropped.save(buf, format='PNG')
    return buf.getvalue(), cropped


def _arr_to_bytes(arr):
    buf = io.BytesIO()
    Image.fromarray(arr.astype(np.uint8)).save(buf, format='PNG')
    return buf.getvalue()


def _extract_feat(pil_img):
    """从检测区域提取 HOG 特征向量"""
    gray = np.array(pil_img.convert('L'))
    # CLAHE 增强对比度
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4))
    enhanced = clahe.apply(gray)
    # 自适应二值化
    binary = cv2.adaptiveThreshold(
        enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, 11, 2
    )
    # 确保前景=白
    if (binary == 0).sum() < (binary == 255).sum():
        binary = 255 - binary
    resized = cv2.resize(binary, (FEAT_SIZE, FEAT_SIZE), interpolation=cv2.INTER_LANCZOS4)
    arr = resized.astype(np.float32) / 255.0
    return _to_hog(arr.flatten())


def _ocr_ensemble(crop_bytes, crop_img=None):
    """
    同一区域用 5 种预处理分别 OCR，投票取最佳结果
    返回 (最佳字符, 置信度, 所有结果集合)
    crop_img: 可选已解码的 PIL Image，避免重复解码
    """
    if crop_img is None:
        crop_img = Image.open(io.BytesIO(crop_bytes))
    gray = np.array(crop_img.convert('L'))

    # 锁外预处理，减少锁持有时间
    preprocessed = [crop_bytes]  # 1. 原图
    try:
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        preprocessed.append(_arr_to_bytes(binary))  # 2. Otsu
    except Exception:
        preprocessed.append(None)
    try:
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(4, 4))
        preprocessed.append(_arr_to_bytes(clahe.apply(gray)))  # 3. CLAHE
    except Exception:
        preprocessed.append(None)
    try:
        preprocessed.append(_arr_to_bytes(255 - gray))  # 4. 反色
    except Exception:
        preprocessed.append(None)
    try:
        blurred = cv2.GaussianBlur(gray, (3, 3), 0)
        _, binary2 = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        preprocessed.append(_arr_to_bytes(binary2))  # 5. 高斯+Otsu
    except Exception:
        preprocessed.append(None)

    # 只在调 _ocr.classification 时加锁
    results = []
    with _model_lock:
        for data in preprocessed:
            if data is None:
                results.append('')
                continue
            try:
                results.append(_ocr.classification(data))
            except Exception:
                results.append('')

    # 过滤空结果
    valid = [r for r in results if r and len(r) == 1]
    if not valid:
        valid = [r for r in results if r]
        if not valid:
            return '?', 0.0, set()

    counter = Counter(valid)
    char, count = counter.most_common(1)[0]
    confidence = count / len(results)
    return char, confidence, set(valid)


# ═══════════════════════════════════════════════════════════════════
# 相似度计算 & 求解
# ═══════════════════════════════════════════════════════════════════
def _cosine_sim(a, b):
    a = a - a.mean()
    b = b - b.mean()
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na < 1e-7 or nb < 1e-7:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def _best_variant_sim(variants, feat):
    """在所有渲染变体中找最高相似度"""
    if not variants:
        return 0.0
    best = -1.0
    for v in variants:
        s = _cosine_sim(v, feat)
        if s > best:
            best = s
    return best


def _dist(a, b):
    return ((a['x'] - b['x']) ** 2 + (a['y'] - b['y']) ** 2) ** 0.5


def solve_click_captcha(img_bytes: bytes, prompt: str, img: Image.Image = None) -> tuple[list[dict], tuple[int, int]]:
    """
    核心求解函数，返回 (结果列表, (宽, 高))
    """
    t0 = time.time()

    # ── 1. 检测 ──
    with _model_lock:
        boxes = _det.detection(img_bytes)
    if not boxes:
        raise ValueError('未检测到任何汉字区域')

    if img is None:
        img = Image.open(io.BytesIO(img_bytes))
    min_dist = min(img.width, img.height) * 0.08

    # ── 2. 裁剪 + OCR 集成 + 特征提取 ──
    detected = []
    for box in boxes:
        crop_bytes, crop_img = _crop_image(img, box)
        char, confidence, all_results = _ocr_ensemble(crop_bytes, crop_img)
        cx = (box[0] + box[2]) / 2
        cy = (box[1] + box[3]) / 2
        feat = _extract_feat(crop_img)
        detected.append({
            'char': char,
            'confidence': confidence,
            'all_ocr': all_results,
            'x': cx, 'y': cy,
            'feat': feat,
        })

    ocr_summary = [f'{d["char"]}({d["confidence"]:.0%})' for d in detected]
    log.info(f'检测到 {len(detected)} 个目标: {ocr_summary}')
    log.info(f'提示字符: {list(prompt)}, 最小距离: {min_dist:.0f}px')

    # ── 3. 渲染提示字变体 ──
    prompt_vars = {}
    for ch in set(prompt):
        prompt_vars[ch] = _render_variants(ch)

    # ── 4. 综合评分矩阵 ──
    n = len(prompt)
    m = len(detected)
    score = [[0.0] * m for _ in range(n)]

    has_hog = len(_all_font_paths) > 0

    for pi in range(n):
        variants = prompt_vars.get(prompt[pi], [])
        for di in range(m):
            # (a) HOG 图像相似度 — 主导项
            img_sim = 0.0
            if has_hog and variants:
                img_sim = _best_variant_sim(variants, detected[di]['feat'])

            # (b) OCR 集成加分 — 辅助信号
            ocr_bonus = 0.0
            if detected[di]['char'] == prompt[pi]:
                ocr_bonus = 0.3 * detected[di]['confidence']
            elif prompt[pi] in detected[di]['all_ocr']:
                ocr_bonus = 0.15

            # 无 HOG 时 OCR 权重提升
            if not has_hog:
                ocr_bonus *= 3.0

            score[pi][di] = img_sim + ocr_bonus

    # 打印评分矩阵
    for pi in range(n):
        row = ', '.join(f'{score[pi][di]:.3f}' for di in range(m))
        log.info(f'评分[{prompt[pi]}]: [{row}]')

    # ── 5. 全排列搜索 ──
    best_total = -float('inf')
    best_perm = None

    for perm in permutations(range(m), n):
        # 距离约束
        ok = True
        for i in range(n):
            for j in range(i + 1, n):
                if _dist(detected[perm[i]], detected[perm[j]]) < min_dist:
                    ok = False
                    break
            if not ok:
                break
        if not ok:
            continue

        total = sum(score[i][perm[i]] for i in range(n))
        if total > best_total:
            best_total = total
            best_perm = perm

    # 无合法分配时放宽距离约束
    if best_perm is None:
        log.warning('无可行分配，放宽距离约束重试')
        for perm in permutations(range(m), n):
            total = sum(score[i][perm[i]] for i in range(n))
            if total > best_total:
                best_total = total
                best_perm = perm

    if best_perm is None:
        raise ValueError('无法找到合法分配方案')

    # ── 6. 组装结果 ──
    result = []
    for i in range(n):
        di = best_perm[i]
        d = detected[di]
        result.append({'x': round(d['x'], 1), 'y': round(d['y'], 1)})
        log.info(
            f'  "{prompt[i]}" → 检测[{di}] '
            f'(OCR="{d["char"]}" {d["confidence"]:.0%}, '
            f'score={score[i][di]:.3f})'
        )

    elapsed = (time.time() - t0) * 1000
    log.info(f'求解完成，耗时 {elapsed:.0f}ms')
    return result, (img.width, img.height)


# ═══════════════════════════════════════════════════════════════════
# HTTP 路由
# ═══════════════════════════════════════════════════════════════════
@app.route('/click', methods=['POST'])
def click():
    """点选验证码识别接口"""
    t0 = time.time()
    try:
        data = request.get_json(force=True)
        image_b64 = data.get('image', '')
        prompt = data.get('remark', '')

        if not image_b64 or not prompt:
            return jsonify({'success': False, 'message': '缺少 image 或 remark 参数'}), 400

        # 去除可能的 data:image 前缀
        if ',' in image_b64:
            image_b64 = image_b64.split(',', 1)[1]

        img_bytes = base64.b64decode(image_b64)
        points, _ = solve_click_captcha(img_bytes, prompt)
        result_str = '|'.join(f'{p["x"]},{p["y"]}' for p in points)

        elapsed = (time.time() - t0) * 1000
        log.info(f'✅ [click] 完成: prompt="{prompt}" result="{result_str}" 耗时={elapsed:.0f}ms')

        return jsonify({
            'success': True,
            'data': {'result': result_str, 'id': ''}
        })
    except Exception as e:
        elapsed = (time.time() - t0) * 1000
        log.error(f'❌ [click] 失败 ({elapsed:.0f}ms): {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/captcha_direct', methods=['POST'])
def captcha_direct():
    """点选验证码直接识别接口（输出归一化坐标，兼容 helper 格式）"""
    t0 = time.time()
    try:
        data = request.get_json(force=True)
        image_b64 = data.get('image', '')
        prompt = data.get('text', '') or data.get('remark', '')

        if not image_b64 or not prompt:
            return jsonify({'success': False, 'message': '缺少 image 或 text 参数'}), 400

        # 去除可能的 data:image 前缀
        if ',' in image_b64:
            image_b64 = image_b64.split(',', 1)[1]

        img_bytes = base64.b64decode(image_b64)

        points, (width, height) = solve_click_captcha(img_bytes, prompt)

        # 构造归一化坐标的 click_coords
        click_coords = []
        for i, p in enumerate(points):
            char_val = prompt[i] if i < len(prompt) else ''
            click_coords.append({
                "char": char_val,
                "nx": round(p['x'] / width, 4),
                "ny": round(p['y'] / height, 4)
            })

        elapsed = (time.time() - t0) * 1000
        log.info(f'✅ [direct] 完成: prompt="{prompt}" coords={click_coords} 耗时={elapsed:.0f}ms')

        return jsonify({
            'success': True,
            'result': {
                'success': True,
                'click_coords': click_coords
            }
        })
    except Exception as e:
        elapsed = (time.time() - t0) * 1000
        log.error(f'❌ [direct] 失败 ({elapsed:.0f}ms): {e}')
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/health', methods=['GET'])
def health():
    """健康检查"""
    return jsonify({
        'status': 'ok',
        'engine': 'ddddocr',
        'fonts': len(_all_font_paths),
        'platform': sys.platform,
    })


# ═══════════════════════════════════════════════════════════════════
# 启动
# ═══════════════════════════════════════════════════════════════════
if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='glm_bypass 验证码识别服务')
    parser.add_argument('--host', default='127.0.0.1', help='监听地址')
    parser.add_argument('--port', type=int, default=8888, help='监听端口')
    parser.add_argument('--debug', action='store_true', help='调试模式')
    args = parser.parse_args()

    print(f'''
╔══════════════════════════════════════════════╗
║   glm_bypass — 验证码识别服务                ║
║   地址: http://{args.host}:{args.port}              ║
║   字体: {len(_all_font_paths)} 个中文字体                     ║
║   引擎: ddddocr + HOG 特征匹配              ║
╚══════════════════════════════════════════════╝
    ''')

    app.run(host=args.host, port=args.port, debug=args.debug, threaded=True)
