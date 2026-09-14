import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { IMPORT_SPECS } from "@optix/types";
import { validateRows, type RefIndex } from "./routers/import.js";
const DIR = new URL("../../../docs/import/ready/", import.meta.url).pathname;
function parse(file: string): Record<string,string>[] {
  const txt = readFileSync(DIR+file,"utf8");
  const rows:string[][]=[]; let row:string[]=[]; let cell=""; let q=false;
  for(let i=0;i<txt.length;i++){const c=txt[i];
    if(q){ if(c==='"'){ if(txt[i+1]==='"'){cell+='"';i++;} else q=false;} else cell+=c; }
    else if(c==='"') q=true;
    else if(c===",") {row.push(cell);cell="";}
    else if(c==="\n"){row.push(cell);rows.push(row);row=[];cell="";}
    else if(c!=="\r") cell+=c;}
  if(cell||row.length){row.push(cell);rows.push(row);}
  const head=rows.shift()!;
  return rows.filter(r=>r.some(v=>v!=="")).map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]??""])));
}
const empty=():RefIndex=>({project:new Map(),location:new Map(),employee:new Map(),warehouse:new Map()});
const noEx=(s:any)=>Object.fromEntries(s.unique.map((k:string)=>[k,new Set<string>()]));
function run(label:string,spec:any,rows:any[],refs:RefIndex){
  const out=validateRows(spec,rows,refs,noEx(spec));
  const bad=out.filter(r=>r.errors.length);
  console.log(`\n=== ${label}: ${out.length} rows, ${bad.length} bad ===`);
  const t=new Map<string,number>();
  for(const r of bad) for(const e of r.errors){const k=`${e.column}: ${e.message}`;t.set(k,(t.get(k)??0)+1);}
  for(const [k,v] of [...t].sort((a,b)=>b[1]-a[1]).slice(0,12)) console.log(`   ${v} x ${k}`);
  if(bad.length) console.log("   first bad:",JSON.stringify(bad[0]!.values));
  return bad;
}
describe("ready/ against the live importer",()=>{
  const projects=parse("projects.csv");
  it("projects",()=>{ expect(run("projects",IMPORT_SPECS.project,projects,empty())).toHaveLength(0); });
  it("equipment (projects loaded, NO employees)",()=>{
    const refs=empty();
    for(const p of projects) refs.project.set(p.name!.toLowerCase(),"p-"+p.project_code);
    expect(run("equipment",IMPORT_SPECS.vehicle,parse("equipment.csv"),refs)).toHaveLength(0);
  });
  it("small tools (no locations, no projects needed)",()=>{
    expect(run("small-tools",IMPORT_SPECS.asset,parse("small-tools.csv"),empty())).toHaveLength(0);
  });
  it("headers match the spec exactly",()=>{
    const hdr=(f:string)=>readFileSync(DIR+f,"utf8").split("\n")[0]!.trim();
    expect(hdr("projects.csv")).toBe(IMPORT_SPECS.project.columns.map(c=>c.header).join(","));
    expect(hdr("equipment.csv")).toBe(IMPORT_SPECS.vehicle.columns.filter(c=>c.header!=="ownership").map(c=>c.header).join(","));
    expect(hdr("small-tools.csv")).toBe(IMPORT_SPECS.asset.columns.map(c=>c.header).join(","));
  });
});
