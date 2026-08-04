const { execSync } = require('child_process');

async function testQianwenUI() {
  try {
    console.log('=== 测试千问 UI 元素 ===');
    
    // 先激活千问
    execSync('open -a "Qianwen"', { timeout: 5000 });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 获取窗口列表
    const windows = execSync(`osascript -e 'tell application "System Events" to get name of every window of application process "Qianwen"'`, { timeout: 5000 });
    console.log('千问窗口名称:', windows.toString().trim());
    
    // 获取第一个窗口的 UI 元素
    const uiElements = execSync(`osascript -e 'tell application "System Events" to get name of every UI element of window 1 of application process "Qianwen"'`, { timeout: 10000 });
    console.log('\nUI 元素名称列表:');
    uiElements.toString().split(', ').forEach((el, i) => {
      console.log(`${i + 1}. ${el.trim()}`);
    });
    
    // 搜索包含"复制"的元素
    const copyElements = execSync(`osascript -e 'tell application "System Events" to get name of every UI element of window 1 of application process "Qianwen" whose name contains "复制"'`, { timeout: 5000 });
    console.log('\n包含"复制"的元素:', copyElements.toString().trim());
    
  } catch (error) {
    console.error('测试失败:', error.message);
  }
}

testQianwenUI();
