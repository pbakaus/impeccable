const markers = ['<img', '<a', '<button'];
const pattern = /<img [^>]*badges[^>]*>/gi;
const single = '<img alt="">';
const double = "<img src='#'>";
const escaped = 'it\'s <img alt="">';
const multiline = `
  <img>
  ${'<img src="">'}
  ${`nested <img>`}
`;
const classes = /[<img >\/]+/;
const tagged = html`<img src="#">`;
// <img>
/* <img src=""> */
