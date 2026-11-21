import { summarizeLoginResponse } from "../src/jwgl_diagnostics.mjs";

function equal(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Unexpected safe login summary");
  }
}

Deno.test("classifies login response without exposing its message or token", () => {
  const sensitiveText = "sample-private-value";
  const summary = summarizeLoginResponse({
    code: 0, Msg: "验证码错误 " + sensitiveText,
    data: { token: sensitiveText },
  });
  equal(summary, { code: "rejected", token: "present", notice: "mentions_verification" });
  if (JSON.stringify(summary).includes(sensitiveText)) throw new Error("Private text leaked");
});

Deno.test("distinguishes successful code from absent token and generic failure", () => {
  equal(summarizeLoginResponse({ code: "1", data: {} }),
    { code: "success", token: "absent", notice: "none" });
  equal(summarizeLoginResponse({ code: "0", Msg: "登录失败！" }),
    { code: "rejected", token: "absent", notice: "generic_failure" });
  equal(summarizeLoginResponse({ code: "0", Msg: "用户名或密码错误" }),
    { code: "rejected", token: "absent", notice: "mentions_credentials" });
});

Deno.test("unknown or malformed replies produce fixed categories only", () => {
  equal(summarizeLoginResponse({ code: "sample-private-value", Msg: "sample-private-value" }),
    { code: "other_or_missing", token: "absent", notice: "other" });
  equal(summarizeLoginResponse(null),
    { code: "other_or_missing", token: "absent", notice: "none" });
});
