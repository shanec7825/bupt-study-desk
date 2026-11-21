// Summaries are fixed categories. Never include upstream text, credentials or tokens.
export function summarizeLoginResponse(payload) {
  const rawCode = payload?.code;
  const code = rawCode === 1 || rawCode === "1" ? "success"
    : rawCode === 0 || rawCode === "0" ? "rejected" : "other_or_missing";
  const token = payload?.data?.token ? "present" : "absent";
  const message = [payload?.Msg, payload?.msg, payload?.message]
    .find(value => typeof value === "string" && value.trim());
  let notice = "none";
  if (message) {
    if (/验证码|校验码|captcha|verification code/i.test(message)) notice = "mentions_verification";
    else if (/密码|账号|账户|用户名|学号|password|username|account/i.test(message)) notice = "mentions_credentials";
    else if (/^登录失败[!！。.]?$/.test(message.trim())) notice = "generic_failure";
    else notice = "other";
  }
  return { code, token, notice };
}
