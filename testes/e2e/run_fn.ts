const orig = Deno.serve
// deno-lint-ignore no-explicit-any
;(Deno as any).serve = (h: any) => orig({ port: Number(Deno.env.get('FN_PORT')), hostname: '127.0.0.1', onListen() {} }, h)
await import(Deno.args[0])
