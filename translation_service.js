// 阿里云百炼平台翻译API服务
// 这个模块使用HTTP请求而非WebSocket来处理翻译功能
class TranslationService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        // 更新为正确的翻译API端点
        this.apiUrl = 'https://dashscope.aliyuncs.com/api/v1/services/language/text/translation';
        this.translationCallbacks = new Map(); // 存储翻译回调函数
        this.translationCounter = 0; // 用于生成唯一ID
    }

    // 生成一个唯一的任务ID
    generateTaskId() {
        this.translationCounter++;
        return `translation-${Date.now()}-${this.translationCounter}`;
    }

    // 翻译文本
    async translate(text, sourceLang, targetLang, callback) {
        if (!this.apiKey) {
            console.error('翻译服务需要提供API Key');
            return { success: false, message: 'API Key不能为空' };
        }

        if (!text || text.trim() === '') {
            console.warn('翻译文本为空');
            return { success: false, message: '翻译文本不能为空' };
        }

        // 生成翻译任务ID
        const taskId = this.generateTaskId();
        
        // 将回调存储在映射表中
        if (callback) {
            this.translationCallbacks.set(taskId, callback);
        }

        try {
            // 构建翻译请求参数 - 根据阿里云百炼平台的API格式
            const requestBody = {
                model: 'gummy-translation-v1',
                input: {
                    text: text
                },
                parameters: {
                    source_language: sourceLang,
                    target_language: targetLang
                }
            };

            console.log('发送翻译请求:', requestBody);

            // 发起HTTP请求
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(requestBody)
            });

            // 解析响应
            const responseData = await response.json();
            console.log('翻译响应:', responseData);
            
            if (response.ok) {
                // 成功获取翻译结果
                let translatedText = '';
                
                // 从响应中提取翻译文本（适应不同的响应格式）
                if (responseData.output?.text) {
                    translatedText = responseData.output.text;
                } else if (responseData.output?.translation) {
                    translatedText = responseData.output.translation;
                } else if (responseData.output?.translated_text) {
                    translatedText = responseData.output.translated_text;
                } else if (responseData.result?.translation) {
                    translatedText = responseData.result.translation;
                } else if (typeof responseData.output === 'string') {
                    translatedText = responseData.output;
                }
                
                const result = {
                    success: true,
                    isTranslation: true,
                    originalText: text,
                    translatedText: translatedText || text,
                    taskId: taskId,
                    rawResponse: responseData // 保留原始响应用于调试
                };
                
                // 调用回调函数
                if (callback) {
                    callback(result);
                    // 从映射表中删除已处理的回调
                    this.translationCallbacks.delete(taskId);
                }
                
                return result;
            } else {
                // 请求失败
                console.error('翻译请求失败:', responseData);
                const errorResult = {
                    success: false,
                    originalText: text,
                    message: responseData.message || responseData.error?.message || '翻译请求失败',
                    taskId: taskId,
                    code: responseData.error?.code || response.status
                };
                
                if (callback) {
                    callback(errorResult);
                    this.translationCallbacks.delete(taskId);
                }
                
                return errorResult;
            }
        } catch (error) {
            // 捕获网络错误或解析错误
            console.error('翻译过程发生错误:', error);
            const errorResult = {
                success: false,
                originalText: text,
                message: error.message || '翻译过程发生错误',
                taskId: taskId
            };
            
            if (callback) {
                callback(errorResult);
                this.translationCallbacks.delete(taskId);
            }
            
            return errorResult;
        }
    }

    // 添加一个回退方法，如果主要翻译API失败，尝试使用文本生成API
    async translateWithFallback(text, sourceLang, targetLang, callback) {
        try {
            // 先尝试使用翻译API
            const result = await this.translate(text, sourceLang, targetLang);
            
            // 如果翻译成功且有结果，直接返回
            if (result.success && result.translatedText && result.translatedText !== text) {
                if (callback) callback(result);
                return result;
            }
            
            // 翻译API失败，尝试使用文本生成API
            console.log('翻译API失败，尝试使用文本生成API...');
            return await this.translateWithTextGeneration(text, sourceLang, targetLang, callback);
            
        } catch (error) {
            console.error('翻译过程发生错误:', error);
            // 尝试文本生成API
            return await this.translateWithTextGeneration(text, sourceLang, targetLang, callback);
        }
    }
    
    // 使用文本生成API进行翻译
    async translateWithTextGeneration(text, sourceLang, targetLang, callback) {
        const taskId = this.generateTaskId();
        
        try {
            // 文本生成API端点
            const textGenUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
            
            // 根据源语言和目标语言构建提示
            const prompt = `将下面的${this.getLanguageName(sourceLang)}文本翻译成${this.getLanguageName(targetLang)}:\n"${text}"`;
            
            const requestBody = {
                model: 'qwen-turbo',  // 使用通义千问模型
                input: {
                    prompt: prompt
                },
                parameters: {
                    temperature: 0.1,  // 低温度以获得更确定的结果
                    result_format: 'text'
                }
            };
            
            console.log('发送文本生成请求:', prompt);
            
            // 发起HTTP请求
            const response = await fetch(textGenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(requestBody)
            });
            
            // 解析响应
            const responseData = await response.json();
            console.log('文本生成响应:', responseData);
            
            if (response.ok && responseData.output) {
                // 清理翻译结果中的引号
                let translatedText = responseData.output.text || '';
                translatedText = translatedText.trim().replace(/^["']|["']$/g, '');
                
                const result = {
                    success: true,
                    isTranslation: true,
                    originalText: text,
                    translatedText: translatedText,
                    taskId: taskId,
                    method: 'text-generation'
                };
                
                if (callback) {
                    callback(result);
                }
                
                return result;
            } else {
                console.error('文本生成请求失败:', responseData);
                const errorResult = {
                    success: false,
                    originalText: text,
                    message: responseData.message || '文本生成请求失败',
                    taskId: taskId
                };
                
                if (callback) {
                    callback(errorResult);
                }
                
                return errorResult;
            }
        } catch (error) {
            console.error('文本生成过程发生错误:', error);
            const errorResult = {
                success: false,
                originalText: text,
                message: error.message || '文本生成过程发生错误',
                taskId: taskId
            };
            
            if (callback) {
                callback(errorResult);
            }
            
            return errorResult;
        }
    }
    
    // 获取语言名称（用于提示）
    getLanguageName(code) {
        const languageMap = {
            'zh': '中文',
            'en': '英语',
            'ja': '日语',
            'ko': '韩语',
            'fr': '法语',
            'de': '德语',
            'es': '西班牙语',
            'ru': '俄语'
        };
        
        return languageMap[code] || code;
    }
}

export default TranslationService;