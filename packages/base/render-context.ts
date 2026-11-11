// The rule for whether a component renders for someone looking at a card or
// for the indexer lives in runtime-common, so base and the host share one copy.
export {
  isLiveRender,
  mayBeLiveRender,
} from '@cardstack/runtime-common/render-context';
