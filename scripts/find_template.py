#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
图像识别：在屏幕截图中查找模板图片（复制按钮）
返回找到的位置坐标（屏幕绝对坐标）
"""

import sys
import json
import os
import tempfile
import subprocess
from PIL import Image

def screenshot_region(x, y, w, h, output_path):
    """截取指定区域的屏幕截图"""
    cmd = ['screencapture', '-x', '-R', f'{x},{y},{w},{h}', output_path]
    subprocess.run(cmd, check=True)

def find_template(template_path, search_x=None, search_y=None, search_w=None, search_h=None, threshold=0.8):
    """
    在屏幕中查找模板图片
    返回: (center_x, center_y, max_val) 或 None
    """
    # 读取模板
    template = Image.open(template_path).convert('RGBA')
    tw, th = template.size
    
    # 确定搜索区域
    if search_x is not None and search_y is not None and search_w is not None and search_h is not None:
        # 截取搜索区域
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
            screenshot_path = f.name
        try:
            screenshot_region(search_x, search_y, search_w, search_h, screenshot_path)
            screen = Image.open(screenshot_path).convert('RGBA')
            offset_x = search_x
            offset_y = search_y
        finally:
            if os.path.exists(screenshot_path):
                os.unlink(screenshot_path)
    else:
        # 全屏截图
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
            screenshot_path = f.name
        try:
            subprocess.run(['screencapture', '-x', screenshot_path], check=True)
            screen = Image.open(screenshot_path).convert('RGBA')
            offset_x = 0
            offset_y = 0
        finally:
            if os.path.exists(screenshot_path):
                os.unlink(screenshot_path)
    
    sw, sh = screen.size
    
    # 如果模板比搜索区域大，返回 None
    if tw > sw or th > sh:
        return None
    
    # 简单模板匹配：逐像素比较
    # 为了性能，用间隔采样（步长为2）
    best_val = 0
    best_pos = None
    
    # 将模板转为像素数据
    template_pixels = list(template.getdata())
    template_has_alpha = any(p[3] < 255 for p in template_pixels[:100])
    
    step = max(1, min(tw, th) // 10)  # 步长根据模板大小调整
    
    for y in range(0, sh - th + 1, step):
        for x in range(0, sw - tw + 1, step):
            # 计算匹配度
            match_count = 0
            total_count = 0
            
            # 采样比较（为了速度，只比较部分像素）
            sample_step = max(1, tw // 8)
            for ty in range(0, th, sample_step):
                for tx in range(0, tw, sample_step):
                    tp = template_pixels[ty * tw + tx]
                    sp = screen.getpixel((x + tx, y + ty))
                    
                    if template_has_alpha and tp[3] < 128:
                        continue  # 透明像素跳过
                    
                    total_count += 1
                    
                    # 计算颜色相似度
                    dr = abs(tp[0] - sp[0])
                    dg = abs(tp[1] - sp[1])
                    db = abs(tp[2] - sp[2])
                    
                    # 容差：每个颜色通道差异小于 30 算匹配
                    if dr < 30 and dg < 30 and db < 30:
                        match_count += 1
            
            if total_count > 0:
                val = match_count / total_count
                if val > best_val:
                    best_val = val
                    best_pos = (x + offset_x, y + offset_y)
    
    if best_pos and best_val >= threshold:
        cx = best_pos[0] + tw // 2
        cy = best_pos[1] + th // 2
        return (cx, cy, best_val)
    
    return None

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': '缺少模板图片路径参数'}))
        return
    
    template_path = sys.argv[1]
    
    # 可选参数：搜索区域
    search_x = int(sys.argv[2]) if len(sys.argv) > 2 else None
    search_y = int(sys.argv[3]) if len(sys.argv) > 3 else None
    search_w = int(sys.argv[4]) if len(sys.argv) > 4 else None
    search_h = int(sys.argv[5]) if len(sys.argv) > 5 else None
    
    # 可选：阈值
    threshold = float(sys.argv[6]) if len(sys.argv) > 6 else 0.75
    
    try:
        result = find_template(template_path, search_x, search_y, search_w, search_h, threshold)
        if result:
            cx, cy, val = result
            print(json.dumps({
                'found': True,
                'center_x': cx,
                'center_y': cy,
                'confidence': round(val, 4)
            }))
        else:
            print(json.dumps({'found': False}))
    except Exception as e:
        print(json.dumps({'error': str(e)}))

if __name__ == '__main__':
    main()
