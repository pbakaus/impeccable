const markers = ['<img', '<button>'];
const pattern = /<img [^>]*badges[^>]*>/;
const text = `picture <img>${'<img>'}`;
export const View = () => <>
  <img alt="" />
  <img src="#" alt="" />
  <img src="/real.png" alt="" />
  <img src={src} alt="" />
  <img {...props} alt="" />
  <div>{'<img src="">'}{/<img [^>]*>/g.test(text)}</div>
  <img alt="after literals" />
</>;
const ratio = width / height;
export const AfterDivision = () => <img />;
const unfinished = '<img';
const literalAfter = '<img src="">';
export const AfterUnfinished = () => <img src="/real.png" />;
export const Nested = () => <div>Don't forget <img /></div>;
export const Attribute = () => <Box icon={<img src="#" />} label="Portrait" />;
if (ready) /<img [^>]*badges[^>]*>/.test(text);
export const AfterCondition = () => <img />;
export const Multi = () => (
  <img
    src={src}
    alt=""
  />
);
export const MultiMissing = () => (
  <img
    alt=""
  />
);
export const Srcset = () => <img srcSet="/a.png 1x" alt="" />;
