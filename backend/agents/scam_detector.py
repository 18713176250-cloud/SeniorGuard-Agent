"""Agent ② 骗术识别：判断是否诈骗/伪健康，并拆解手法。"""
from agents.llm import chat_json

TACTICS = ["伪权威", "情感绑架", "恐惧营销", "虚假疗效", "幸存者偏差", "冒充公检法", "虚假中奖/投资", "限时逼单"]

SYSTEM = f"""你是反诈识别专家，服务对象是老年人。判断输入内容是否为诈骗或伪健康误导，并拆解骗术手法。
可识别的手法：{'、'.join(TACTICS)}。
原则：
1. 只依据文本本身判断；正常的官方科普、正规养生建议、普通通知不要判为诈骗，宁可标为存疑。
2. 证据必须逐字引用原文片段。
3. 无法确定时 verdict 设为 "存疑"，交给人工复核，你只做辅助判断，不做最终定性。
4. claims_to_verify 只写原文里对方的说法或要求本身（陈述句，最多 4 条），供权威对照去核实真假，
   例如「来电者是换了新号码的儿子」「出车祸需要立即向陌生账户转账3万元」「要求不要告诉其他家人」「某药三天根治糖尿病」。
   不要写成核实建议或提醒，例如「需用旧号码回拨核实」「需向交警核实」都是错误写法。
只输出 JSON：
{{"verdict": "诈骗|存疑|正常", "risk_level": "低|中|高", "tactics": [{{"name": "手法名", "evidence": "原文片段", "explain": "一句话说明"}}], "claims_to_verify": ["原文中的说法或要求，如「某药可治愈糖尿病」"], "scam_probability": 0到100的整数, "reason": "一句话总结"}}
scam_probability 是你估计这条内容属于诈骗的可能性（百分比）：诈骗一般 70 以上，存疑 40 到 69，正常 20 以下，要与 verdict 一致。"""


def run(text: str) -> dict:
    if not text.strip():
        return {"verdict": "存疑", "risk_level": "低", "tactics": [], "claims_to_verify": [], "reason": "未识别到任何文字"}
    result = chat_json(SYSTEM, f"待判断内容：\n{text}")
    result.setdefault("tactics", [])
    result.setdefault("claims_to_verify", [])
    try:
        pct = int(round(float(result.get("scam_probability"))))
        result["scam_probability"] = max(0, min(100, pct))
    except (TypeError, ValueError):
        result.pop("scam_probability", None)  # 前端会按 verdict / risk_level 估算
    return result
