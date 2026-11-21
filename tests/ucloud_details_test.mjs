import {
  plainText, mergeWorkDetails, normalizeAttachmentList,
  normalizeHomeworkDetail, detailsForGoogle, mergeGeneratedTaskNotes,
  safeAttachmentUrl, safeAttachmentName
} from "../src/ucloud_details.mjs";

function equal(actual, expected, label = "assert") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(label + ": " + JSON.stringify(actual) + " !== " + JSON.stringify(expected));
  }
}
Deno.test("HTML assignment description is safely converted to readable text", () => {
  const input = "<div>阅读&nbsp;章节<br/>完成&lt;程序&gt;</div><script>secret()</script>";
  equal(plainText(input), "阅读 章节\n完成<程序>");
});
Deno.test("detail and submission view are merged with work/detail priority", () => {
  equal(mergeWorkDetails({assignmentTitle:"Detail title",siteId:8},{assignmentTitle:"Other",assignmentContent:"Body"}),
    {assignmentTitle:"Detail title",assignmentContent:"Body",siteId:8});
});
Deno.test("attachments use trusted resource metadata without guessed download links", () => {
  const detail={assignmentResource:[{resourceId:"f1",resourceName:"讲义.pdf"},{resourceId:"f2",resourceName:"doc.docx"}]};
  const list=normalizeAttachmentList(detail,[{id:"f1",name:"实验说明.pdf",url:"https://files.bupt.edu.cn/a.pdf"}]);
  equal(list.map(a=>[a.resourceId,a.name]),[["f1","实验说明.pdf"],["f2","doc.docx"]]);
  equal(list[1].downloadUrl,"");
  const normalized=normalizeHomeworkDetail({assignmentContent:"<p>实验代码</p>",siteId:8},list);
  equal(normalized.instructions,"实验代码");
  equal(normalized.attachments.length,2);
  if(!detailsForGoogle(normalized).includes("实验说明.pdf")) throw Error("attachment missing");
});
Deno.test("generated details replace without removing user-written text", () => {
  const original="课程：未知课程\n截止：2026-11-12\n[BUPT_SYNC_ID:hw:x]\n用户备注";
  const withDetails=mergeGeneratedTaskNotes(original,"实验要求");
  const updated=mergeGeneratedTaskNotes(withDetails,"更新要求");
  equal(updated.includes("用户备注"),true);
  equal(updated.includes("更新要求"),true);
  equal(updated.includes("实验要求"),false);
  equal(updated.split("[BUPT_DETAIL_BEGIN]").length,2);
});
Deno.test("external attachment links cannot target localhost or unapproved hosts", () => {
  equal(safeAttachmentUrl("https://files.bupt.edu.cn/f?token=a")?.hostname,"files.bupt.edu.cn");
  equal(safeAttachmentUrl("https://foo.aliyuncs.com/abc")?.hostname,"foo.aliyuncs.com");
  for(const url of ["http://ucloud.bupt.edu.cn/","https://localhost/","https://bupt.edu.cn.evil.test/a","file:///etc/passwd","https://127.0.0.1/a"]){
    equal(safeAttachmentUrl(url),null);
  }
  equal(safeAttachmentName("../hello\\file.txt"),"_hello_file.txt");
});
