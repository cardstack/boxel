// The cases every outbound address policy must agree on: whether each address
// is on the public internet. The ai-bot's readUrl and the realm server's
// outbound guard each keep their own copy of the policy, because both need
// `node:net` and this package also runs in the browser; both test suites run
// their `isPublicAddress` over every case here, so neither copy can drift from
// the other.
//
// The policy: an IPv4 address is public unless it is in a private, loopback,
// link-local, carrier-grade NAT, multicast, reserved or documentation range. A
// native IPv6 address is public only inside global unicast (2000::/3), and not
// in its special-purpose blocks (2001::/23, 2001:db8::/32, 2002::/16,
// 3fff::/20). An IPv4-mapped IPv6 address (::ffff:a.b.c.d, dotted or hex) is
// judged by the IPv4 rules. An address may be bracketed; anything that isn't
// an IP literal is not public.
//
// This module is data only: it must stay importable in the browser and in
// Node without pulling in anything else.

export interface AddressPolicyCase {
  address: string;
  public: boolean;
  label: string;
}

export const addressPolicyCases: readonly AddressPolicyCase[] = [
  // IPv4
  { address: '127.0.0.1', public: false, label: 'IPv4 loopback' },
  { address: '10.1.2.3', public: false, label: 'IPv4 private 10/8' },
  { address: '172.16.0.1', public: false, label: 'IPv4 private 172.16/12' },
  { address: '172.20.0.5', public: false, label: 'IPv4 private 172.16/12' },
  { address: '192.168.1.1', public: false, label: 'IPv4 private 192.168/16' },
  { address: '169.254.10.20', public: false, label: 'IPv4 link-local' },
  { address: '169.254.169.254', public: false, label: 'IPv4 metadata' },
  { address: '100.64.0.1', public: false, label: 'IPv4 carrier-grade NAT' },
  { address: '0.0.0.0', public: false, label: 'IPv4 unspecified' },
  { address: '224.0.0.1', public: false, label: 'IPv4 multicast' },
  { address: '8.8.8.8', public: true, label: 'IPv4 public' },
  { address: '1.1.1.1', public: true, label: 'IPv4 public' },
  { address: '93.184.215.14', public: true, label: 'IPv4 public' },
  { address: '104.18.0.1', public: true, label: 'IPv4 public' },

  // IPv4-mapped IPv6
  {
    address: '::ffff:127.0.0.1',
    public: false,
    label: 'IPv4-mapped loopback, dotted',
  },
  {
    address: '::ffff:7f00:1',
    public: false,
    label: 'IPv4-mapped loopback, hex',
  },
  {
    address: '::ffff:169.254.169.254',
    public: false,
    label: 'IPv4-mapped metadata',
  },
  { address: '::ffff:10.0.0.1', public: false, label: 'IPv4-mapped private' },
  {
    address: '::ffff:8.8.8.8',
    public: true,
    label: 'IPv4-mapped public, dotted',
  },
  { address: '::ffff:808:808', public: true, label: 'IPv4-mapped public, hex' },

  // IPv6 outside global unicast
  { address: '::1', public: false, label: 'IPv6 loopback' },
  { address: '::', public: false, label: 'IPv6 unspecified' },
  { address: 'fd00::1', public: false, label: 'IPv6 unique local' },
  { address: 'fd12:3456::1', public: false, label: 'IPv6 unique local' },
  { address: 'fd00:ec2::254', public: false, label: 'IPv6 metadata' },
  { address: 'fe80::1', public: false, label: 'IPv6 link-local' },
  { address: 'fec0::1', public: false, label: 'IPv6 site-local' },
  { address: 'ff02::1', public: false, label: 'IPv6 multicast' },
  {
    address: '::127.0.0.1',
    public: false,
    label: 'IPv4-compatible loopback, dotted',
  },
  {
    address: '::7f00:1',
    public: false,
    label: 'IPv4-compatible loopback, hex',
  },
  {
    address: '::ffff:0:7f00:1',
    public: false,
    label: 'IPv4-translated loopback',
  },
  {
    address: '64:ff9b::7f00:1',
    public: false,
    label: 'NAT64 well-known prefix embedding loopback',
  },
  {
    address: '64:ff9b::a00:1',
    public: false,
    label: 'NAT64 well-known prefix embedding a private address',
  },
  {
    address: '64:ff9b:1::a00:1',
    public: false,
    label: 'NAT64 local-use prefix',
  },
  { address: '100:0:0:1::1', public: false, label: 'IPv6 discard-only' },
  { address: '5f00::1', public: false, label: 'IPv6 segment-routing SID' },
  { address: '4000::1', public: false, label: 'IPv6 unassigned' },

  // IPv6 special-purpose blocks inside global unicast
  {
    address: '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    public: false,
    label: 'Teredo',
  },
  { address: '2001:2::1', public: false, label: 'IPv6 benchmarking' },
  { address: '2001:10::1', public: false, label: 'ORCHID' },
  { address: '2001:db8::1', public: false, label: 'IPv6 documentation' },
  { address: '3fff::1', public: false, label: 'IPv6 documentation 3fff::/20' },
  {
    address: '3fff:fff::1',
    public: false,
    label: 'IPv6 documentation 3fff::/20, last block',
  },
  {
    address: '2002:7f00:1::1',
    public: false,
    label: '6to4 embedding loopback',
  },
  {
    address: '2002:a00:1::1',
    public: false,
    label: '6to4 embedding a private address',
  },
  {
    address: '2002:808:808::1',
    public: false,
    label: '6to4 embedding a public address',
  },

  // IPv6 global unicast
  { address: '2606:4700::1111', public: true, label: 'IPv6 public' },
  {
    address: '[2606:4700::1111]',
    public: true,
    label: 'IPv6 public, bracketed',
  },
  { address: '2001:4860:4860::8888', public: true, label: 'IPv6 public' },
  {
    address: '3fff:1000::1',
    public: true,
    label: 'IPv6 public, just past 3fff::/20',
  },

  // Not an IP literal
  { address: 'not-an-address', public: false, label: 'not an IP literal' },
];
