import test from 'node:test';
import assert from 'node:assert/strict';
import { hardConstraintGate,candidateScore,finalScore } from '../backend/src/pipeline/scoring.mjs';
import { dedupeCandidates } from '../backend/src/pipeline/dedup.mjs';

test('hard constraints reject explicit colour conflict',()=>{
  const intent={explicit_constraints:{color:'black'}};
  assert.equal(hardConstraintGate(intent,{caption:'Nike Air Max 270 red',ad_copy:'red shoe'}).pass,false);
});
test('missing colour evidence is not a mismatch',()=>{
  const intent={explicit_constraints:{color:'black'}};
  assert.equal(hardConstraintGate(intent,{caption:'Nike Air Max 270',ad_copy:''}).pass,true);
});
test('candidate score rewards identity terms',()=>{
  const intent={brand:'Nike',product_family:'Air Max',model:'Air Max 270',explicit_constraints:{color:'black'},category:'footwear'};
  const score=candidateScore(intent,{caption:'Nike Air Max 270 black sneaker',ad_copy:'Shop Nike Air Max 270 black',queryUsed:'Nike Air Max 270 black'});
  assert.ok(score>=70);
});
test('final score is weighted from candidate and visual score',()=>assert.equal(finalScore(80,90),86));
test('dedupe removes duplicate external ids',()=>{
  const xs=[{platform:'INSTAGRAM',externalVideoId:'1',canonicalUrl:'https://a'},{platform:'INSTAGRAM',externalVideoId:'1',canonicalUrl:'https://b'},{platform:'INSTAGRAM',externalVideoId:'2',canonicalUrl:'https://c'}];
  assert.equal(dedupeCandidates(xs).length,2);
});

test('perceptual hash removes near-duplicate thumbnails', async()=>{
  const { safePerceptualHash } = await import('../backend/src/pipeline/phash.mjs');
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="black"/><circle cx="32" cy="32" r="14" fill="white"/></svg>');
  const data=`data:image/svg+xml;base64,${svg.toString('base64')}`;
  const hash=await safePerceptualHash(data);
  const xs=[
    {platform:'INSTAGRAM',externalVideoId:'a',canonicalUrl:'https://a',perceptualHash:hash},
    {platform:'INSTAGRAM',externalVideoId:'b',canonicalUrl:'https://b',perceptualHash:hash}
  ];
  assert.equal(dedupeCandidates(xs).length,1);
});

test('final score does not override hard constraint semantics',()=>{
  const intent={brand:'Nike',model:'Air Max 270',explicit_constraints:{color:'black'}};
  const candidate={caption:'Nike Air Max 270 red',ad_copy:'red sneaker',queryUsed:'Nike Air Max 270 red'};
  assert.equal(hardConstraintGate(intent,candidate).pass,false);
  assert.equal(finalScore(98,98),98);
});
