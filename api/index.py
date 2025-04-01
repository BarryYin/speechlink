import os
from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import json # Corrected indentation

app = Flask(__name__)
# 允许所有来源访问 /api/* 路径 (Vercel 会处理生产环境的 CORS)
# 或者更严格地配置允许的来源
CORS(app, resources={r"/api/*": {"origins": "*"}}) # 允许所有来源，Vercel部署时通常需要

# 阿里云 Dashscope API 端点
DASHSCOPE_TRANSLATE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/language/text/translation'
DASHSCOPE_TEXT_GEN_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation'

def get_language_name(code):
    """根据语言代码获取语言名称，用于文本生成提示"""
    language_map = {
        'zh': '中文', 'en': '英语', 'ja': '日语', 'ko': '韩语',
        'fr': '法语', 'de': '德语', 'es': '西班牙语', 'ru': '俄语',
        'yue': '粤语', 'it': '意大利语' # 添加新语言
    }
    # 如果是 auto，返回空字符串或特定提示，避免加入 prompt
    if code == 'auto':
        return '' # 或者 '自动检测到的语言'，但空字符串更适合 prompt
    return language_map.get(code, code)

# 修改路由路径，适配 Vercel 部署环境
@app.route('/api/translate', methods=['POST'])
def translate_proxy():
    """代理翻译请求到阿里云 Dashscope"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Invalid JSON payload"}), 400

        text = data.get('text')
        source_language = data.get('source_language')
        target_language = data.get('target_language')
        api_key = data.get('api_key') # 从前端获取 API Key

        if not all([text, source_language, target_language, api_key]):
            return jsonify({"error": "Missing required parameters: text, source_language, target_language, api_key"}), 400

        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}'
        }

        # --- 尝试主要翻译 API ---
        translate_payload = {
            "model": "gummy-translation-v1",
            "input": {
                "text": text
            },
            "parameters": {
                # "source_language": source_language, # 由下面逻辑控制
                "target_language": target_language
            }
        }
        # 如果源语言不是 'auto'，则添加到参数中
        if source_language != 'auto':
            translate_payload['parameters']['source_language'] = source_language
            print(f"Attempting translation API for: {text} (from {source_language})")
        else:
             # 如果是 'auto'，则不设置 source_language 参数，让 API 自动检测
             print(f"Attempting translation API for: {text} (auto-detect source)")

        try:
            response = requests.post(DASHSCOPE_TRANSLATE_URL, headers=headers, json=translate_payload, timeout=10)
            response.raise_for_status() # 如果状态码不是 2xx，则抛出异常
            result_data = response.json()
            print(f"Translation API response: {result_data}")

            # 提取翻译结果 (适应不同可能的响应结构)
            output = result_data.get('output', {})
            translated_text = output.get('translation') or \
                              output.get('text') or \
                              output.get('translated_text') or \
                              (isinstance(output, str) and output)

            if translated_text:
                 return jsonify({
                    "success": True,
                    "translated_text": translated_text,
                    "method": "translation_api"
                 })

            # 如果主要 API 成功但没有返回有效翻译，记录日志但继续尝试 fallback
            print("Translation API succeeded but no valid translation found in output.")

        except requests.exceptions.RequestException as e:
            print(f"Translation API request failed: {e}")
            # 如果请求失败（网络错误、超时、非2xx状态码），则继续尝试 fallback
            pass # 继续尝试文本生成 API
        except json.JSONDecodeError as e:
             print(f"Failed to decode Translation API JSON response: {e}")
             pass # 继续尝试文本生成 API

        # --- 尝试文本生成 API (Fallback) ---
        print("Attempting text generation API (fallback)...")
        try:
            # 构建 prompt，如果源语言是 auto，则提示可能不准确，但尽力而为
            source_lang_name = get_language_name(source_language)
            target_lang_name = get_language_name(target_language)
            if source_lang_name:
                 prompt = f"将下面的{source_lang_name}文本翻译成{target_lang_name}:\n\"{text}\""
            else: # 源语言是 auto
                 prompt = f"将下面的文本翻译成{target_lang_name}:\n\"{text}\""

            text_gen_payload = {
                "model": "qwen-turbo",
                "input": {
                    "prompt": prompt
                },
                "parameters": {
                    "temperature": 0.1,
                    "result_format": "text"
                }
            }

            response = requests.post(DASHSCOPE_TEXT_GEN_URL, headers=headers, json=text_gen_payload, timeout=15)
            response.raise_for_status()
            result_data = response.json()
            print(f"Text generation API response: {result_data}")

            output = result_data.get('output', {})
            generated_text = output.get('text', '').strip().strip('"\'') # 清理结果

            if generated_text:
                return jsonify({
                    "success": True,
                    "translated_text": generated_text,
                    "method": "text_generation_api"
                })
            else:
                 return jsonify({"error": "Fallback API failed to generate translation"}), 500

        except requests.exceptions.RequestException as e:
            print(f"Text generation API request failed: {e}")
            return jsonify({"error": f"Fallback API request failed: {e}"}), 500
        except json.JSONDecodeError as e:
             print(f"Failed to decode Text generation API JSON response: {e}")
             return jsonify({"error": f"Failed to decode Fallback API JSON response: {e}"}), 500
        except Exception as e:
            print(f"Unexpected error during fallback: {e}")
            return jsonify({"error": f"Unexpected error during fallback: {e}"}), 500

    except Exception as e:
        print(f"General error in /api/translate: {e}")
        return jsonify({"error": f"An unexpected error occurred: {e}"}), 500

# 为了同时兼容本地开发环境，也添加一个 /translate 路由
@app.route('/translate', methods=['POST'])
def translate_proxy_local():
    """本地环境路由 - 转发到主要处理函数"""
    return translate_proxy()

# Vercel 会自动寻找名为 'app' 的 Flask 实例, 不需要 app.run()
