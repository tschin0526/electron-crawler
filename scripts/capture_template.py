#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从屏幕截图中裁剪模板图片
用户先把游标移到目标按钮上，等待5秒后截图，
然后以游标为中心裁剪出指定大小的图片作为模板
"""

import sys
import json
import os
import subprocess
import tempfile
from PIL import Image

def get_mouse_position():
    """获取当前鼠标位置"""
    script = '''
    ObjC.import('AppKit');
    var p = $.NSEvent.mouseLocation;
    var h = $.NSScreen.mainScreen.frame.size.height;
    Math.round(p.x) + ',' + Math.round(h - p.y);
    '''
    result = subprocess.run(
        ['osascript', '-l', 'JavaScript', '-e', script],
        capture_output=True, text=True, check=True
    )
    parts = result.stdout.strip().split(',')
    return int(parts[0]), int(parts[1])

def capture_template(output_path, size=40, delay=5):
    """
    等待 delay 秒后，以游标位置为中心裁剪 size×size 的图片作为模板
    """
    import time
    time.sleep(delay)
    
    # 获取游标位置
    mx, my = get_mouse_position()
    
    # 全屏截图
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
        screenshot_path = f.name
    try:
        subprocess.run(['screencapture', '-x', screenshot_path], check=True)
        screen = Image.open(screenshot_path)
        sw, sh = screen.size
        
        # 计算裁剪区域（以游标为中心）
        half = size // 2
        left = max(0, mx - half)
        top = max(0, my - half)
        right = min(sw, mx + half)
        bottom = min(sh, my + half)
        
        # 裁剪
        template = screen.crop((left, top, right, bottom))
        template.save(output_path)
        
        return {
            'success': True,
            'template_path': output_path,
            'mouse_x': mx,
            'mouse_y': my,
            'template_size': size
        }
    finally:
        if os.path.exists(screenshot_path):
            os.unlink(screenshot_path)

def main():
    if len(sys.argv) < 3:
        print(json.dumps({'error': '用法: capture_template.py <output_path> <size> [delay]'}))
        return
    
    output_path = sys.argv[1]
    size = int(sys.argv[2])
    delay = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    
    try:
        result = capture_template(output_path, size, delay)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'error': str(e)}))

if __name__ == '__main__':
    main()
