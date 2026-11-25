import type ApplicationInstance from '@ember/application/instance';

import type HostRouteLinksService from '../services/host-route-links';

// Arm the link bridge at boot.
//
// The `hrefTo` helper is card code, with no owner to inject a service from,
// so it reads the service that gives links their URLs from a global the
// service registers itself on. Ember services are lazy, so without this the
// first links to render would find nothing registered.
export function initialize(appInstance: ApplicationInstance): void {
  appInstance.lookup('service:host-route-links') as
    | HostRouteLinksService
    | undefined;
}

export default {
  initialize,
};
