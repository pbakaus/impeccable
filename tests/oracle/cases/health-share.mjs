const base = {
  verb: 'health', workspace: 'ctx-empty',
  env: { IMPECCABLE_HOME: '<WS>/.oracle-home/impeccable' },
};
export default [
  { ...base, id: 'health-share-parent-usage', args: ['invalid'] },
  { ...base, id: 'health-share-usage', args: ['share', '--help'] },
  { ...base, id: 'health-share-invalid', args: ['share', '--unexpected'] },
  { ...base, id: 'health-share-empty-publish', args: ['share', '--no-label', '--no-trend'] },
  { ...base, id: 'health-share-signed-out', args: ['share'] },
  { ...base, id: 'health-share-unshare-usage', args: ['unshare', '--help'] },
  { ...base, id: 'health-share-unshare-signed-out', args: ['unshare'] },
];
