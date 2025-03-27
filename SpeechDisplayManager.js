/**
 * 语音识别文本显示管理器
 * 用于处理实时语音识别结果的展示，避免重复内容
 */
class SpeechDisplayManager {
  constructor() {
    // 存储当前完整的识别结果
    this.completeText = '';
    // 存储已显示给用户的文本片段
    this.displayedSegments = [];
  }

  /**
   * 处理新收到的识别文本
   * @param {string} newText - 从API收到的新文本片段
   * @returns {string|null} - 需要显示的新文本，如无需显示则返回null
   */
  processNewText(newText) {
    // 如果是空文本则忽略
    if (!newText || newText.trim() === '') return null;
    
    // 检查是否与已显示的任何片段有重叠
    for (const segment of this.displayedSegments) {
      if (segment.includes(newText) || newText.includes(segment)) {
        // 如果新文本是已显示片段的子字符串，或者已显示片段是新文本的子字符串，忽略
        return null;
      }
    }
    
    // 将此片段添加到已显示列表
    this.displayedSegments.push(newText);
    
    // 如果显示的历史片段太多，清理一些旧的
    if (this.displayedSegments.length > 20) {
      this.displayedSegments = this.displayedSegments.slice(-20);
    }
    
    return newText;
  }
  
  /**
   * 重置管理器状态
   */
  reset() {
    this.completeText = '';
    this.displayedSegments = [];
  }
}

export default SpeechDisplayManager;
