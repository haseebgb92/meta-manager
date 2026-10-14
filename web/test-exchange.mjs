import assert from "node:assert/strict";
import {exchangeInstagramToken, publicInstagramError, InstagramExchangeError, classifyInstagramError} from "./instagram-exchange.mjs";

const opts={clientId:"public-test",clientSecret:"PRIVATE_DO_NOT_LOG",code:"CODE_DO_NOT_LOG",redirectUri:"https://example.org/callback"};
function mockResponse(status,body){return {ok:status>=200&&status<300,status,json:async()=>body};}
const upstreamBad=async()=>mockResponse(400,{error_type:"OAuthException",code:400,error_message:"Invalid authorization code"});
await assert.rejects(exchangeInstagramToken(opts,upstreamBad),err=>{
  assert.ok(err instanceof InstagramExchangeError);
  assert.equal(err.reason,"instagram_code_invalid");
  assert.equal(err.stage,"instagram_code_exchange");
  const safe=publicInstagramError(err);
  assert.equal(safe.status,422);
  assert.equal(safe.body.providerHttpStatus,400);
  assert.ok(!JSON.stringify(safe).includes(opts.code));
  assert.ok(!JSON.stringify(safe).includes(opts.clientSecret));
  return true;
});
const badSecret=classifyInstagramError("instagram_code_exchange",400,{error_message:"Invalid client secret"});
assert.equal(badSecret.reason,"instagram_client_configuration");
const wrongRedirect=classifyInstagramError("instagram_code_exchange",400,{error_message:"redirect_uri does not match"});
assert.equal(wrongRedirect.reason,"instagram_redirect_mismatch");
const invalidLong=async(url)=>url.includes("api.instagram.com")?
  mockResponse(200,{access_token:"SHORT_TEST_TOKEN"}):
  mockResponse(400,{error:{message:"Invalid authorization code"}});
await assert.rejects(exchangeInstagramToken(opts,invalidLong),err=>{
  assert.equal(err.stage,"instagram_long_token_exchange");
  return true;
});
let calls=0;
const success=async()=>mockResponse(200,++calls===1?{access_token:"SHORT_TEST_TOKEN"}:{access_token:"LONG_TEST_TOKEN",expires_in:5184000});
const token=await exchangeInstagramToken(opts,success);
assert.equal(token.access_token,"LONG_TEST_TOKEN");
assert.equal(calls,2);
console.log("Instagram broker safe token-stage diagnostic tests passed");
