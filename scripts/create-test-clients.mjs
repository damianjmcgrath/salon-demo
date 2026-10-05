// Run locally with Node, never in a browser. Does not modify staff identities.
import { createClient } from '@supabase/supabase-js';
const url = process.env.SUPABASE_URL || 'https://xmvujvwyfxawtazjiymd.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY locally; never commit or share it.');
if (url !== 'https://xmvujvwyfxawtazjiymd.supabase.co') throw new Error('This script is restricted to the salon test project.');
const db = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const password = process.env.SALON_TEST_PASSWORD || '123456';
const clients = [
 ['jacqui@example.com','Jacqui Durnin','+353 879 942 716'],
 ['aoife@example.com','Aoife Durnin','+353 111 111 111'],
 ['damian@example.com','Damian McGrath','+44 7891 039749'],
];
const users=[];
for(let page=1;;page++) {
 const {data,error}=await db.auth.admin.listUsers({page,perPage:1000});
 if(error) throw error;
 users.push(...data.users);
 if(data.users.length<1000) break;
}
for(const [email,name,phone] of clients) {
 const existing=users.find(u=>u.email?.toLowerCase()===email);
 if(existing) {
  const {data,error}=await db.from('staff_users').select('user_id').eq('user_id',existing.id);
  if(error) throw error;
  if(data.length) throw new Error(`${email} belongs to a staff/admin/accountant login; refusing to overwrite it.`);
 }
 const payload={password,email_confirm:true,user_metadata:{full_name:name,mobile:phone}};
 const result=existing ? await db.auth.admin.updateUserById(existing.id,payload) : await db.auth.admin.createUser({email,...payload});
 if(result.error) throw new Error(`${email}: ${result.error.message}. If the password policy rejects 123456, set SALON_TEST_PASSWORD to a permitted password and rerun.`);
 const {error}=await db.from('clients').upsert({auth_user_id:result.data.user.id,name,email,phone},{onConflict:'auth_user_id'});
 if(error) throw error;
 console.log(`Ready: ${email}`);
}
