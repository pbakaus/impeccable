// Regenerates css-rules.json: the expected output of the JS
// `collectStaticCssRules` / `unwrapCssAtLayer` (css-cascade.mjs + css-tree)
// over the synthetic corpus below plus every <style> block and .css file
// under the repo's tests/, skill/ and cli/.
//
//   node crates/html/tests/fixtures/gen-css-rules.mjs
//
// FROZEN. `cli/engine/engines/static-html/css-cascade.mjs` was removed when
// the runtime went node-free, so this cannot run against this repo; it is kept
// as the record of how css-rules.json was produced. IMPECCABLE_PUBLIC_REPO
// points it at a checkout old enough to still have that module (css-tree is
// loaded from that checkout's node_modules).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  process.env.IMPECCABLE_PUBLIC_REPO,
  path.resolve(here, '..', '..', '..', '..'),
].filter(Boolean);
const root = candidates.find(p => fs.existsSync(path.join(p, 'cli', 'engine', 'engines', 'static-html', 'css-cascade.mjs')));
if (!root) throw new Error('css-cascade.mjs not found; set IMPECCABLE_PUBLIC_REPO to a pre-node-free checkout');
const require = createRequire(path.join(root, 'package.json'));
const csstree = require('css-tree');
const m = await import(path.join(root, 'cli', 'engine', 'engines', 'static-html', 'css-cascade.mjs'));

const synthetic = [
  // nested @media / @supports / @layer
  '@media (max-width:600px){ .a{color:red} @supports (display:grid){ .b{color:blue}}}',
  '@media screen { @media (min-width:1px) { .a{color:red} } }',
  '@supports (display:grid) and (not (display:inline-grid)) { .grid{display:grid} }',
  '@layer base { .a{color:red} } @layer{ .b{color:red} } @layer a, b; @layer x.y { .c{color:green} }',
  '@layer utilities { @media (min-width: 640px) { .sm\\:flex { display: flex } } }',
  '@media print { @layer foo { .p{margin:0} } }',
  '@layer a { @layer b { @layer c { .deep{x:y} } } }',
  '@layer reset, base; @layer base { html{margin:0} } @layer reset { *{box-sizing:border-box} }',
  '@supports not (display:grid) { @media (max-width: 400px) { @layer x { .m{n:o} } } }',
  '@media (min-width: 640px) { .container { max-width: 640px } } @media (min-width: 768px) { .container { max-width: 768px } }',
  '@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important } }',
  '@supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) { .glass { backdrop-filter: blur(12px) } }',
  '@media (a{b) { .x{c:d} } .y{e:f}',
  '@media (a; b) { .x{c:d} } .y{e:f}',
  '@media (a; b { .x{c:d} } .y{e:f}',
  '@media (a) foo { .x{c:d} } .y{e:f}',
  '@media { .x{c:d} } @media; .y{e:f} @media',
  '@media{}.b{c:d} @MEDIA (x){a{b:c}} @Layer X{a{b:c}} @supports(x:y){a{b:c}}',
  '@media (x){ .b {c:d} .c{ }} ',
  'a{b:x;@media (y){c:d}} e{f:g}',
  // :hover shapes
  '.a:hover, .b:hover > .c, .d:hover.e, .f:hover ~ , .g:hover{color:red}',
  'a:hover>b{c:d} a:hover+b{c:d} a:hover b{c:d} a:hover >{c:d} a:hover b:hover{c:d} :hover{c:d} a:not(:hover){c:d} a:hover:focus{c:d}',
  'a:hover, :hover.b, .b :hover .c, > a:hover{c:d}',
  '.a:HOVER{color:red} .a:hover-x{c:d} .hover{m:n} a:hovering{o:p} a\\:hover{c:d} a[data-x=":hover"]{c:d}',
  '.a :hover .b{c:d} .a  :hover  .b{c:d} :hover > .b{c:d} .a > :hover{c:d} .a ~ :hover ~ .b{c:d}',
  '.a:hover::before{content:""} .btn:hover:not(:disabled){color:red}',
  // comma selectors
  'a, b, c , d{color:red}',
  '.a[data-x="a,b"], .b:is(.x, .y){color:red}',
  // !important
  '.a{color:red !important; b: c ! important ; d: e!IMPORTANT; f: g !ie; h: i!important !important}',
  'a{b:c!important !important} a{b:c !important d} a{b:c!importantx} a{b:!important} a{ b : c ; } a{b: c!important} a{b:c ! important}',
  '.a{b: 1px !important; c: 2px ! important; d: 3px !important ; e:4px!important;}',
  // custom properties
  '.a { --x: red ; color: var(--x); --y:  { a: b } ; --z:; --w: ; --empty:  ;}',
  ':root{--brand: #87a8ff; --pad:  4px 8px } .card{border-left: 5px solid var(--brand); padding: var(--pad, 1px)}',
  '.a{ color : var( --x , red ) ; width: var(--w); z: var(--a,var(--b, 1px))}',
  // malformed CSS recovery
  '.a{color:red;;;} .b{color:red',
  '.a{color:red} } .b{color:blue}',
  '.a{color:red;}}}.b{color:blue}',
  '.a{color:red}@media (a){.b{color:blue}',
  '.a { color: red } .b { color: blue',
  'a{b:c;d',
  'a{b}',
  'a{color:}',
  '{a:b}',
  '}',
  '{',
  'a{',
  'a{}',
  '',
  '   ',
  'a',
  '.a{color:red}"str}"{}.b{color:blue}',
  'a{color:red;background:blue{}} a{color:red;background:blue{c:d} e:f;g:h;} i{j:k}} l{m:n}',
  'a{b:x;c:d{e:f}} a{b:x;c:hover{d:e}} a{b:x;c{d:e}} a{color:red;--y} a{;b:c} a{b:c;;d:e}',
  'a{b:x;&:hover{c:d}} a{&:hover{c:d}} a{b:x;> c{d:e}} a{b:x;.c{d:e}}',
  '.a{content:"\\\n"} .b{content:"multi\\\nline"} .c{content:"bad\nstring"; color:red}',
  '.a{c:"unterminated} .b{color:red}',
  '.a{c:url(unterminated} .b{color:red}',
  '.a{c:url("unterminated} .b{color:red}',
  '.a{c:calc(1px + } .b{color:red}',
  '.a{c:[ } .b{color:red}',
  '.a{width:50%} 50%{c:d} 5{c:d} .5{c:d} 5px{c:d} +a{c:d} .a + {c:d} .a > {c:d} > .a{c:d} ~{c:d}',
  // comments
  '/* only */',
  '.a{color: /* comment */ red; /*c*/ background:blue} /* between */ .b{c:d}',
  '.a{color:red}/*}*/.b{color:blue}',
  '.a{color:red}\n/* trailing',
  '/*! bang */ .a{color:red}',
  'a::after{content:"}"} b{c:d} c{d:"}"} e{f:g} h{i:c /* } */} d{e:f} j{b:url(}) } k{e:f}',
  'a{b:red   /* x */   blue; c: red\n  blue\t green; d:(1+2); e:[a b]; f:{a:b}; g:foo(bar(baz)); h:a,b,,c; i:a , , b; j:foo( , ); k:foo(1 2)}',
  'a{b:1px !important;} a{b:  x  } a{b:x\n} a{b:x;\n} a{b:x /**/} a{b:x/**/y} a{b:x/**/} a{b:/**/x}',
  // @import / @font-face / @keyframes / other at-rules
  '.a{color:red}<!-- .b{color:blue} -->',
  "@import url(x.css); @import 'y.css' layer(base) supports(display:grid) screen; .z{color:red}",
  '@font-face{font-family:x; src: url(x.woff2) format("woff2")} a{b:c}',
  '@keyframes x { from{opacity:0} to{opacity:1} } @-webkit-keyframes k2{from{a:b}} @media(x){@keyframes k3{from{a:b}} a{b:c}} .z{color:red}',
  '@page{margin:0} @page :first{margin:1px} @container (min-width: 1px){ .a{color:red}} @scope (.x){ .y{c:d}} @starting-style{ .z{opacity:0}}',
  '@charset "utf-8"; @namespace svg url(http://www.w3.org/2000/svg); a{b:c}',
  '@font-face{font-family:x} @media (x){ @font-face{font-family:y} .z{c:d} }',
  'a{b:c}@font-face{d:e}f{g:h}',
  '.a{color:red}@media{}.b{c:d}',
  // value normalization
  '.A > .B{COLOR:Red} html{-webkit-text-size-adjust:100%} a{width:100PX;color:Rgb(1,2,3)}',
  '.a{background: url( foo.png ) no-repeat , linear-gradient( 90deg , red 0% , blue 100% )}',
  '.a{transition: all .3s ease-in-out,color 1s; animation: spin 1s linear infinite}',
  '.a{font: italic bold 12px/30px Georgia, serif; font: 12px / 1.5 x}',
  '.a{width: calc( 100% - 2px ); height: calc(1px + 2px*3); x: calc( (1 + 2) * 3 )}',
  '.a{margin:-1px +2px .5em 1.50px 010px; b:1 -2; c:1 - 2; d:1-2; e: 1px+2px; f: a+b; g:1*2}',
  '.a{transform: translate(10px,20px) rotate(45deg); filter: blur( 2px ); grid-template-columns: repeat( auto-fill , minmax( 100px , 1fr ) )}',
  '.a{color:#FFF; background:#abcdef80; content:"a b"; font-family: "Foo Bar" , sans-serif; x: \'single\'; y: "esc\\"aped"}',
  '.a::before{content:"\\201C"} .b::after{content:"\\"}"} .c{content:\'}\'}',
  '.a{background:URL(x.png); b:url(  "x"  ); c:url("x y.png"); d:url(x y.png); e:url(x)y; f:image-set(url(x) 1x)}',
  '.a{color:rgb(0 0 0 / 50%); b: rgb( 1 , 2 , 3 ); c: hsl(120deg 100% 50%)}',
  '.a{unicode-range: U+0025-00FF, u+4??; x: 1/2 ; y: a/b; aspect-ratio: 16 / 9}',
  'a{b:1E3;c:1e-3px;d:.5;e:0.50;f:+.5;g:1.2.3;h:1..2;i:.;j:-;k:--;l:--x;m:@x;n:$x;o:x$;p:x @y;q:#;r:#ggg}',
  'a{*b:c;_d:e;b:1\\9;c:expression(1);filter:progid:DXImageTransform.Microsoft.gradient(startColorstr=#80000000,endColorstr=#80000000)}',
  'a{b:c;}\r\nd{e:f} g{h:i;}\f j{k:l} m{n:o;}\v p{q:r}',
  '.a{margin: 0 0 0 0} .b{margin: 0 auto  0px 1e3px} .c{padding: 1px 2px 3px}',
  '.a{b:1px 2px} .a{b:1px2px} .a{b:1e3 1e-3} .a{b:#fff #000} .a{b:x#fff} .a{b:#fff x} .a{b:1px#fff} .a{b:x -y} .a{b:x --y} .a{b:x -1} .a{b:) x} .a{b:x ) y}',
  // selector normalization
  '*{a:b} :root{c:d} ::selection{e:f} :root:hover{g:h}',
  'a:is(.x,.y):where(#z){c:d} a:not( .x , .y ){c:d} :where(.a .b, .c) > d{e:f} :has(> img){c:d}',
  'li:nth-child(2n+1){c:d} li:nth-child( 2n + 1 ){c:d} li:nth-child(odd){c:d} li:nth-child(-n+3){c:d} li:nth-child(n){c:d} li:nth-of-type(3){c:d} li:nth-child(2 of .x){c:d} li:nth-last-child(+2n-1){c:d}',
  'p:lang(en, "fr"){c:d} ::slotted(span){c:d} :host(.x){c:d} :host-context(body.dark){c:d} :dir(rtl){c:d} a:foo(  bar baz ){c:d} a:foo(){c:d} a::part(x){c:d}',
  'a > b , c+d ~ e   f{color:red} g   >   h{i:j} k\n>\nl{m:n} a /deep/ b{c:d} *|* {c:d} |a{c:d} svg|circle{c:d}',
  '#id{c:d} a#id{c:d} #id.cls{c:d} .cls#id{c:d} #a#b{c:d} a#b c{d:e} #\\31 23{c:d}',
  'a[b]{c:d} a[b=c]{c:d} a[b="c"]{c:d} a[b=\'c\']{c:d} a[ b |= c ]{c:d} a[b="c" i]{c:d} a[b=c s]{c:d} a[ data-x = "y" i ]{c:d} a[*|b]{c:d} a[|b]{c:d}',
  // unicode / escapes / BOM
  '\uFEFF.a{color:red}',
  '.é{color:red} .日本{color:blue} a[data-x="ünïcode"]{c:d} .a{content:"emoji 😀"} .b{font-family:"Nöto"}',
  '.a{c:\\26 B; d: \\000026x; e:\\26x} .\\31 0{c:d} .a\\ b{c:d}',
  '.a{b:c} \u00a0 d{e:f}',
  '.a{b:c} \u2028 d{e:f}',
];

function extractStyles(html) {
  const out = [];
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out.join('\n');
}

const cases = [];
for (const css of synthetic) cases.push({ name: 'synthetic', css });

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(html|css)$/.test(e.name)) acc.push(p);
  }
}
const files = [];
walk(path.join(root, 'tests'), files);
walk(path.join(root, 'skill'), files);
walk(path.join(root, 'cli'), files);
files.sort();
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const css = f.endsWith('.css') ? text : extractStyles(text);
  if (!css.trim()) continue;
  cases.push({ name: path.relative(root, f), css });
}

let total = 0;
for (const c of cases) {
  c.rules = m.collectStaticCssRules(c.css, csstree);
  c.unwrapped = m.unwrapCssAtLayer(c.css);
  total += c.rules.length;
}
fs.writeFileSync(path.join(here, 'css-rules.json'), JSON.stringify(cases));
console.log(cases.length, 'cases', total, 'rules', files.length, 'files');
