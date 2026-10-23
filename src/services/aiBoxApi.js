const { OpenAI } = require('openai');
require('dotenv').config();
const config = require('../config');

const openai = new OpenAI({
  apiKey: process.env.BOXAPI_KEY || '',
  baseURL: 'https://ai.boxapi.ir/ai/v1',
});

async function getTradeSignal({ symbol, bestBid, bestAsk, freeQuote, freeBase, techData, avgBuyPrice, minNotional }) {
  try {
    const targetSell = avgBuyPrice > 0 ? (avgBuyPrice * (1 + config.TAKE_PROFIT_PCT)).toFixed(0) : 0;
    const stopLoss = avgBuyPrice > 0 ? (avgBuyPrice * (1 - config.STOP_LOSS_PCT)).toFixed(0) : 0;

    const promptText = `
شما یک ربات معامله‌گر الگوریتمی هستید. فقط JSON برگردان.

نماد: ${symbol}
بهترین خرید (bid): ${bestBid}
بهترین فروش (ask): ${bestAsk}
موجودی نقد قابل استفاده: ${freeQuote} تومان
موجودی ارز قابل فروش: ${freeBase}
حداقل مبلغ مجاز هر معامله: ${minNotional} تومان

اندیکاتورها (کندل ۱۵ دقیقه):
- RSI: ${techData.rsi} (${techData.trend})
- MACD Histogram: ${techData.macdHist}

پوزیشن فعلی:
- میانگین خرید: ${avgBuyPrice} تومان
- Take-Profit: ${targetSell} تومان
- Stop-Loss: ${stopLoss} تومان

قوانین قطعی:
1) BUY فقط اگر: موجودی نقد >= ${minNotional} باشد، RSI < 50، MACD Histogram > 0.
   توجه: خرید کسری (fractional) کاملاً مجاز است. مهم نیست قیمت یک واحد ارز چقدر است؛ فقط کافی است ${minNotional} تومان نقد داشته باشی.
2) SELL فقط اگر: موجودی ارز > 0 باشد و (قیمت فعلی >= Take-Profit یا قیمت فعلی <= Stop-Loss).
3) در غیر این صورت HOLD.

پاسخ فقط به این شکل:
{"action":"BUY"|"SELL"|"HOLD","reason":"دلیل کوتاه فارسی"}
`.trim();

    const response = await openai.chat.completions.create({
      model: config.AI_MODEL,
      messages: [{ role: 'user', content: promptText }],
      temperature: 0.1,
    });

    const raw = response.choices?.[0]?.message?.content || '{}';
    const clean = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (!['BUY', 'SELL', 'HOLD'].includes(parsed.action)) {
      return { action: 'HOLD', reason: 'پاسخ AI نامعتبر بود' };
    }
    return { action: parsed.action, reason: String(parsed.reason || '').slice(0, 200) };
  } catch (e) {
    console.error('❌ BoxAPI error details:', e.response ? JSON.stringify(e.response.data) : e.message);
    return { action: 'HOLD', reason: 'خطا در API هوش مصنوعی' };
  }
}

module.exports = { getTradeSignal };