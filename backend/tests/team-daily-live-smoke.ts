import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

// Local development smoke test: read-only HTTP requests, short-lived tokens stay in memory.
dotenv.config();
const database = new URL(process.env.DATABASE_URL!);
assert(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname));
const prisma = new PrismaClient();
try {
  const base = await prisma.orgUnit.findFirst({where:{orgType:'BASE',status:'active'}});
  assert(base, 'A development base is required');
  const manager = await prisma.userIdentity.findFirst({where:{status:'active',user:{status:'active'},OR:[{roleCode:'DEV_ADMIN'},{roleCode:'BASE_ADMIN',orgId:base.id}]}});
  assert(manager, 'A development management identity is required');
  const team = await prisma.userIdentity.findFirst({where:{roleCode:'TEAM_ADMIN',status:'active',user:{status:'active'},org:{orgType:'TEAM',status:'active'}}});
  assert(team, 'A development team identity is required');
  const root = `http://127.0.0.1:${process.env.PORT || '4000'}/api`;
  async function get(url:string, identity?:typeof manager) {
    const response = await fetch(root+url,{headers:identity ? {Authorization:`Bearer ${jwt.sign({userId:identity.userId},process.env.JWT_SECRET || 'dev-secret',{expiresIn:'2m'})}`,'X-Identity-Id':identity.id} : {}});
    const body = await response.json() as any;
    return {status:response.status,body};
  }
  assert.equal((await get('/health')).status,200);
  assert.equal((await get('/team-daily/templates')).status,401);
  for(const url of [`/team-daily/templates?baseOrgId=${base.id}`,`/team-daily/assignments?baseOrgId=${base.id}`,`/tasks/report/team-daily-dashboard/overview?scopeOrgId=${base.id}`,`/tasks/report/team-daily-dashboard/teams/${base.id}/halls`]) {
    const response=await get(url,manager);
    assert.equal(response.status,200,`${url.split('?')[0]}: ${response.body.error?.code}`);
    assert('data' in response.body, 'Expected API data envelope');
  }
  for(const url of ['/team-daily/my-records','/tasks/report/team-daily-dashboard']) {
    const response=await get(url,team);
    assert.equal(response.status,200,`${url}: ${response.body.error?.code}`);
  }
  assert.equal((await get(`/team-daily/templates?baseOrgId=${base.id}`,team)).status,403);
  assert.equal((await get(`/tasks/report/team-daily-dashboard/overview?scopeOrgId=${base.id}`,team)).status,403);
  console.log('PASS: restarted server health, management APIs, team APIs, authentication and role restrictions (read-only)');
} finally { await prisma.$disconnect(); }
