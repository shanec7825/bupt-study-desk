import {CURRENT_TERM_START, isPreviousSemesterDeadline, isPreviousSemesterPendingTask} from "../src/semester.mjs";
function check(actual,expected,msg) {if(actual!==expected) throw new Error(msg+" expected "+expected+" got "+actual);}
Deno.test("2026 previous semester boundary is fixed and exact",()=>{
 check(CURRENT_TERM_START,"2026-09-01","cutoff");
 check(isPreviousSemesterDeadline(new Date("2026-08-31T23:59:00+08:00")),true,"prior semester");
 check(isPreviousSemesterDeadline(new Date("2026-09-01T00:00:00+08:00")),false,"current semester");
 check(isPreviousSemesterDeadline(null),false,"unknown deadline");
});
Deno.test("cleanup only explicitly tagged unfinished archived BUPT tasks",()=>{
 const task={id:"x",status:"needsAction",due:"2026-07-15T00:00:00.000Z",notes:"课程：x\n[BUPT_SYNC_ID:hw:123]"};
 check(isPreviousSemesterPendingTask(task),true,"old pending synced task");
 check(isPreviousSemesterPendingTask({...task,status:"completed"}),false,"completed should survive");
 check(isPreviousSemesterPendingTask({...task,due:"2026-10-15T00:00:00.000Z"}),false,"current semester should survive");
 check(isPreviousSemesterPendingTask({...task,notes:"personal note"}),false,"manual should survive");
 check(isPreviousSemesterPendingTask({...task,due:undefined}),false,"undated should survive");
 check(isPreviousSemesterPendingTask({...task,parent:"parent-id"}),false,"subtask should survive");
});
