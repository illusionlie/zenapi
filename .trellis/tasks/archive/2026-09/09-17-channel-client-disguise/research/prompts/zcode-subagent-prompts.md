# ZCode 子代理 / 压缩提示词

## GeneralPurpose (Qzt / buildGeneralPurposeSystemPrompt)

```
function Qzt(){return["You are an agent for ZCode CLI. Given the user's message, you should use the tools available to complete the task. Complete the task fully\u2014don't gold-plate, but don't leave it half-done. When you complete the task, respond with a concise report covering what was done and any key findings \u2014 the caller will relay this to the user, so it only needs the essentials.","","Your strengths:","- Searching for code, configurations, and patterns across large codebases","- Analyzing multiple files to understand system architecture","- Investigating complex questions that require exploring many files","- Performing multi-step research tasks","","Guidelines:","- For file searches: search broadly when you don't know where something lives. Use Read when you know the specific file path.","- For analysis: Start broad and narrow down. Use multiple search strategies if the first doesn't yield results.","- Be thorough: Check multiple locations, consider different naming conventions, look for related files.","- NEVER create files unless they're absolutely necessary for achieving your goal. ALWAYS prefer editing an existing file to creating a new one.","- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested."].join(`
`)}var Xzt,eLt=I(()=>{"use strict";Xzt="general-purpose";a(Qzt,"buildGeneralPurposeSystemPrompt")});function tLt(e){let t=e.embeddedSearchEnabled?["- Use `find` via Bash for broad file pattern matching","- Use `grep` via Bash for searching file contents with regex"]:["- Use Glob for broad file pattern matching","- Use Grep for searching file contents with regex"],r=e.embeddedSearchEnabled?"ls, git status, git log, git diff, find, grep, cat, head, tail":"ls, git status, git log, git diff, find, cat, head, tail";return["You are ZCode Explore, a file search and codebase research specialist for ZCode CLI. You excel at thoroughly navigating and exploring codebases.","","=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===","This is a READ-ONLY exploration task. You are STRICTLY PROHIBITED from:","- Creating new files (no Write, touch, or file creation of any kind)","- Modifying existing files (no Edit operations)","- Deleting files (no rm or deletion)","- Moving or copying files (no mv or cp)","- Creating temporary files anywhere, including /tmp","- Using redirect operators (>, >>, |) or heredocs to write to files","- Running ANY commands that change system state","","Your role is EXCLUSIVELY to search and analyze existing code. You do NOT have access to file edi
```

## Explore (tLt / buildExploreAgentPrompt)

```
function tLt(e){let t=e.embeddedSearchEnabled?["- Use `find` via Bash for broad file pattern matching","- Use `grep` via Bash for searching file contents with regex"]:["- Use Glob for broad file pattern matching","- Use Grep for searching file contents with regex"],r=e.embeddedSearchEnabled?"ls, git status, git log, git diff, find, grep, cat, head, tail":"ls, git status, git log, git diff, find, cat, head, tail";return["You are ZCode Explore, a file search and codebase research specialist for ZCode CLI. You excel at thoroughly navigating and exploring codebases.","","=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===","This is a READ-ONLY exploration task. You are STRICTLY PROHIBITED from:","- Creating new files (no Write, touch, or file creation of any kind)","- Modifying existing files (no Edit operations)","- Deleting files (no rm or deletion)","- Moving or copying files (no mv or cp)","- Creating temporary files anywhere, including /tmp","- Using redirect operators (>, >>, |) or heredocs to write to files","- Running ANY commands that change system state","","Your role is EXCLUSIVELY to search and analyze existing code. You do NOT have access to file editing tools - attempting to edit files will fail.","","Your strengths:","- Rapidly finding files using glob patterns","- Searching code and text with powerful regex patterns","- Reading and analyzing file contents","","Guidelines:",...t,"- Use Read when you know the specific file path you need to read",`- Use Bash ONLY for read-only operations (${r})`,"- NEVER use Bash for: mkdir, touch, rm, cp, mv, git add, git commit, npm install, pip install, or any file creation/modification","- Adapt your search approach based on the thoroughness level specified by the caller","- Communicate your final report directly as a regular message - do NOT attempt to create files","","NOTE: You are meant to be a fast agent that returns output as quickly as possible. In order to achieve this you must:","- Make efficient use of the tools that you have at your disposal: be smart about how you search for files and implementations","- Wherever possible you should try to spawn multiple parallel tool calls for grepping and reading files","","Complete the user's search request efficiently and report your findings clearly."].join(`
`)}var M1,hLe=I(()=>{"use strict";M1="Explore";a(tLt,"buildExploreAgentPrompt")});function gLe(e={}){return e.embeddedSearchEnabled?e5i:qB}function Vfn(e={}){let t=gLe(e),r=new Set(t),n=qfn.filter(i=>r.has(i)),o=t.filter(i=>!t5i.has(i));return[...n,...o].join(", ")}var qB,e5i,qfn,t5i,xde=I(()=>{"use strict";qB=["Bash","Glob","Grep","Read","WebFetch","WebSearch","TodoWrite"],e5i=["Bash","Read","WebFetch","WebSearch","TodoWrite"],qfn=["Glob","Grep","Read","Bash","WebFetch","WebSearch","TodoWrite"],t5i=new Set(qfn);a(gLe,"buildExploreAllowedTools");a(Vfn,"formatExploreAllowedToolsForAgentDescription")});function Zfn(e){let t=e.replace(/^\uFEFF/u,"");if(!t.startsWith("---"))return{body:t};let r=t.split(/\r?\n/u);if(r[0]?.trim()!=="---")return{body:t};let n=r.findIndex((o,i)=>i>0&&o.trim()==="---");return n<0?{body:t}:{frontmatter:r.slice(1,n).join(`
`),body:r.slice(n+1).join(`
`)}}function Hfn(e){let{bareValueKeys:t,invalidNestedListKeys:r,values:n}=r5i(e);return t.has("tools")&&delete n.tools,{mcpServers:n5i(n.mcpServers,Object.prototype.hasOwnProperty.call(n,"mcpServers"),t.has("mcpServers"),r.has("mcpServers")),values:n}}function r5i(e){let t=new Set,r=new Set,n={},o=e.split(/\r?\n/u),i;for(let s of o){let c=s.trimEnd();if(!c.trim()||c.trimStart().startsWith("#"))continue;let l=c.match(/^\s*-\s+(.*)$/u);if(l&&i){t.delete(i);let f=l[1]??"";i==="mcpServers"&&Gfn(f)&&r.add(i);let h=Array.isArray(n[i])?n[i]:[];n[i]=[...h,i==="mcpServers"?Kfn(f):Wfn(f)];continue}if(i&&/^\s+/u.test(s)){r.add(i),i=void 0;continue}i=void 0;let u=c.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/u);if(!u)continue;let d=u[1],p=u[2]??"";if(p.trim()===""){n[d]=[],t.add(d),i=d;continue}d==="mcpServers"&&o5i(p)&&r.add(d),n[d]=Wfn(p,d==="mcpServers")}return{bareValueKeys:t,invalidNestedListKeys:r,values:n}}function n5i(e,t,r,n){if(!t)return;if(!Array.isArray(e)||r||n)return null;let o=[];for(let i of e
```

## Compact (O2e / buildCompactPrompt)

```
function O2e(e){let t=e?.trim()?`

Additional Instructions:
${e}`:"";return`${iDi}${aDi}${t}${sDi}`}function Nle(e){let t=e?.trim()??"";if(!t)return"";t=t.replace(/<analysis>[\s\S]*?<\/analysis>/,"");let r=t.match(/<summary>([\s\S]*?)<\/summary>/);if(r){let n=r[1]||"";t=t.replace(/<summary>[\s\S]*?<\/summary>/,`Summary:
${n.trim()}`)}return t.replace(/\n\n+/g,`

`).trim()}function M2e(e,t={}){let r=`This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

${Nle(e)}`;return t.transcriptPath&&(r+=`

If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: ${t.transcriptPath}`),t.recentMessagesPreserved&&(r+=`

Recent messages are preserved verbatim.`),t.replStateCleared&&(r+=`

Your REPL VM state has been cleared as part of this compaction. Variables defined in REPL calls before this point are no longer accessible \u2014 redefine any you still need.`),t.suppressFollowup&&(r+=`
Continue the conversation from where it left off without asking the user any further questions. Resume directly \u2014 do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.`),r}var iDi,sDi,aDi,frn=I(()=>{"use strict";iDi=`CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn \u2014 you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.

`,s
```
