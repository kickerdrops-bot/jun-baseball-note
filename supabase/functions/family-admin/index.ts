import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const CALLBACK_URL = 'https://kickerdrops-bot.github.io/jun-baseball-note/';
const allowedOrigins = new Set((Deno.env.get('ALLOWED_ORIGINS') || 'https://kickerdrops-bot.github.io').split(',').map((x) => x.trim()));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// New hosted projects inject a dictionary of independently rotatable secret keys.
// Keep the legacy fallback only for local/older runtimes during the 2026 transition.
const secretKey = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const messages: Record<string, string> = {
  AUTH_REQUIRED: 'もう一度ログインしてください。',
  MANAGER_REQUIRED: '家族の管理は管理者だけが行えます。',
  ADMIN_BUSY: 'ほかの家族管理操作が進行中です。少し待ってから試してください。',
  ADMIN_LEASE_EXPIRED: '操作の有効時間を過ぎました。もう一度試してください。',
  WRITER_EXISTS: 'ジュン用の記入アカウントは登録済みです。必要なら再設定リンクを発行してください。',
  ALREADY_MEMBER: 'このメールアドレスは家族に登録済みです。再設定リンクを利用してください。',
  FAMILY_LIMIT: '登録できる家族は30人までです。',
  MEMBER_NOT_FOUND: 'この家族は見つかりません。画面を更新してください。',
  CANNOT_REMOVE_MANAGER: '管理者自身の登録は解除できません。',
  INVALID_RECOVERY_TARGET: '再設定できるのは登録済みの記入者・閲覧者です。管理者の復旧は運用手順を使ってください。',
  INVALID_TARGET: '対象の家族を確認してください。',
  INVALID_INPUT: '入力内容を確認してください。',
  AUTH_LINK_FAILED: '設定リンクを発行できませんでした。少し待ってから試してください。',
};

class RequestError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private',
    'Pragma': 'no-cache',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin && allowedOrigins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (origin && !allowedOrigins.has(origin)) return respond({ error: 'この接続元からは利用できません。' }, 403);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return respond({ error: 'POST required' }, 405);

  let leaseToken: string | null = null;
  let notebookId: string | null = null;
  let actorId: string | null = null;
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const operation = async (action: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await admin.rpc('family_admin_operation', {
      p_notebook_id: notebookId, p_actor_user_id: actorId, p_action: action,
      p_token: leaseToken, ...extra,
    });
    if (error) {
      const code = error.message in messages ? error.message : 'INTERNAL_ERROR';
      throw new RequestError(code, error.code === '42501' ? 403 : error.code === 'P0001' || error.code === '23505' ? 409 : 500);
    }
    return data;
  };
  try {
    const authorization = req.headers.get('authorization') || '';
    if (!/^Bearer [^\s]+$/i.test(authorization)) throw new RequestError('AUTH_REQUIRED', 401);
    // This calls Auth and validates the actual JWT. User metadata never grants access.
    const { data: { user }, error: authError } = await admin.auth.getUser(authorization.slice(7));
    if (authError || !user) throw new RequestError('AUTH_REQUIRED', 401);
    actorId = user.id;
    if (Number(req.headers.get('content-length') || 0) > 4096) throw new RequestError('INVALID_INPUT');
    const raw = await req.text();
    if (raw.length > 4096) throw new RequestError('INVALID_INPUT');
    let body;
    try { body = JSON.parse(raw); } catch { throw new RequestError('INVALID_INPUT'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || !UUID.test(body.notebook_id || '')) throw new RequestError('INVALID_INPUT');
    notebookId = body.notebook_id;
    const action = body.action;
    if (!['list', 'invite', 'recovery', 'remove'].includes(action)) throw new RequestError('INVALID_INPUT');

    // Every RPC below rechecks current manager membership inside the database.
    if (action === 'list') return respond(await operation('list'));
    leaseToken = (await operation('begin')).token;
    if (action === 'remove') {
      if (!UUID.test(body.user_id || '')) throw new RequestError('INVALID_INPUT');
      await operation('remove', { p_target_user_id: body.user_id });
      leaseToken = null;
      // Do not delete or mutate Auth users: revoking membership is immediate under RLS,
      // and deleting Auth accounts here could race a new invitation or another notebook.
      return respond({ ok: true });
    }

    let email: string;
    let targetId: string | undefined;
    let linkType: 'invite' | 'recovery';
    if (action === 'invite') {
      if (!['writer', 'viewer'].includes(body.role) || typeof body.email !== 'string') throw new RequestError('INVALID_INPUT');
      email = body.email.trim().toLowerCase();
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RequestError('INVALID_INPUT');
      const lookup = await operation('lookup', { p_email: email });
      if (lookup.user?.role) throw new RequestError('ALREADY_MEMBER', 409);
      if (body.role === 'writer' && lookup.writer_exists) throw new RequestError('WRITER_EXISTS', 409);
      targetId = lookup.user?.user_id;
      // Existing Auth accounts without membership are deliberately re-invited using
      // recovery; existing members can never have their role silently reassigned.
      linkType = targetId ? 'recovery' : 'invite';
    } else {
      if (!UUID.test(body.user_id || '')) throw new RequestError('INVALID_INPUT');
      const { members } = await operation('list');
      const target = members.find((member: { user_id: string }) => member.user_id === body.user_id);
      if (!target || target.role === 'manager') throw new RequestError('INVALID_RECOVERY_TARGET', 403);
      targetId = target.user_id;
      email = target.email;
      linkType = 'recovery';
    }

    const { data, error } = await admin.auth.admin.generateLink({ type: linkType, email, options: { redirectTo: CALLBACK_URL } });
    if (error || !data.user?.id || !data.properties?.hashed_token) throw new RequestError('AUTH_LINK_FAILED', 502);
    if (targetId && targetId !== data.user.id) throw new RequestError('AUTH_LINK_FAILED', 502);
    const link = new URL(CALLBACK_URL);
    link.searchParams.set('token_hash', data.properties.hashed_token);
    link.searchParams.set('type', linkType);
    // No token is returned unless current authorization + the membership commit succeed.
    await operation(action === 'invite' ? 'add' : 'recovery', { p_target_user_id: data.user.id, p_role: body.role || null });
    leaseToken = null;
    return respond({ link: link.toString() });
  } catch (error) {
    const code = error instanceof RequestError ? error.code : 'INTERNAL_ERROR';
    return respond({ error: messages[code] || '家族の管理を完了できませんでした。時間をおいて試してください。', code }, error instanceof RequestError ? error.status : 500);
  } finally {
    if (leaseToken && notebookId && actorId) {
      try { await operation('release'); } catch { /* Lease expires automatically; never log link/user secrets. */ }
    }
  }
});
