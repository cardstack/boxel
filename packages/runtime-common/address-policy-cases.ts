// The cases every outbound address policy must agree on: whether each address
// is on the public internet. The ai-bot's readUrl and the realm server's
// outbound guard each keep their own copy of the policy, because both need
// `node:net` and this package also runs in the browser; both test suites run
// their `isPublicAddress` over every case here.
//
// Each range the policy draws is pinned at its edges: its first and last
// address, and the address just outside it on either side where that address
// is public. So removing, narrowing or widening a range in either copy fails
// that copy's suite.
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

function refused(label: string, ...addresses: string[]): AddressPolicyCase[] {
  return addresses.map((address) => ({ address, public: false, label }));
}

function allowed(label: string, ...addresses: string[]): AddressPolicyCase[] {
  return addresses.map((address) => ({ address, public: true, label }));
}

export const addressPolicyCases: readonly AddressPolicyCase[] = [
  // IPv4 refused ranges, each with the public addresses on either side
  ...refused('IPv4 0.0.0.0/8', '0.0.0.0', '0.255.255.255'),
  ...allowed('IPv4 just past 0.0.0.0/8', '1.0.0.0'),
  ...refused('IPv4 private 10/8', '10.0.0.0', '10.1.2.3', '10.255.255.255'),
  ...allowed('IPv4 either side of 10/8', '9.255.255.255', '11.0.0.0'),
  ...refused(
    'IPv4 carrier-grade NAT 100.64/10',
    '100.64.0.0',
    '100.64.0.1',
    '100.127.255.255',
  ),
  ...allowed('IPv4 either side of 100.64/10', '100.63.255.255', '100.128.0.0'),
  ...refused(
    'IPv4 loopback 127/8',
    '127.0.0.0',
    '127.0.0.1',
    '127.255.255.255',
  ),
  ...allowed('IPv4 either side of 127/8', '126.255.255.255', '128.0.0.0'),
  ...refused(
    'IPv4 link-local 169.254/16',
    '169.254.0.0',
    '169.254.10.20',
    '169.254.169.254',
    '169.254.255.255',
  ),
  ...allowed(
    'IPv4 either side of 169.254/16',
    '169.253.255.255',
    '169.255.0.0',
  ),
  ...refused(
    'IPv4 private 172.16/12',
    '172.16.0.0',
    '172.16.0.1',
    '172.20.0.5',
    '172.31.255.255',
  ),
  ...allowed('IPv4 either side of 172.16/12', '172.15.255.255', '172.32.0.0'),
  ...refused('IPv4 IETF protocol 192.0.0/24', '192.0.0.0', '192.0.0.255'),
  ...allowed('IPv4 either side of 192.0.0/24', '191.255.255.255', '192.0.1.0'),
  ...refused('IPv4 documentation 192.0.2/24', '192.0.2.0', '192.0.2.255'),
  ...allowed('IPv4 either side of 192.0.2/24', '192.0.1.255', '192.0.3.0'),
  ...refused('IPv4 6to4 relay 192.88.99/24', '192.88.99.0', '192.88.99.255'),
  ...allowed(
    'IPv4 either side of 192.88.99/24',
    '192.88.98.255',
    '192.88.100.0',
  ),
  ...refused(
    'IPv4 private 192.168/16',
    '192.168.0.0',
    '192.168.1.1',
    '192.168.255.255',
  ),
  ...allowed(
    'IPv4 either side of 192.168/16',
    '192.167.255.255',
    '192.169.0.0',
  ),
  ...refused('IPv4 benchmarking 198.18/15', '198.18.0.0', '198.19.255.255'),
  ...allowed('IPv4 either side of 198.18/15', '198.17.255.255', '198.20.0.0'),
  ...refused(
    'IPv4 documentation 198.51.100/24',
    '198.51.100.0',
    '198.51.100.255',
  ),
  ...allowed(
    'IPv4 either side of 198.51.100/24',
    '198.51.99.255',
    '198.51.101.0',
  ),
  ...refused('IPv4 documentation 203.0.113/24', '203.0.113.0', '203.0.113.255'),
  ...allowed(
    'IPv4 either side of 203.0.113/24',
    '203.0.112.255',
    '203.0.114.0',
  ),
  ...refused(
    'IPv4 multicast 224/4',
    '224.0.0.0',
    '224.0.0.1',
    '239.255.255.255',
  ),
  ...allowed('IPv4 just before 224/4', '223.255.255.255'),
  ...refused('IPv4 reserved 240/4', '240.0.0.0', '255.255.255.255'),

  // IPv4 public
  ...allowed(
    'IPv4 public',
    '8.8.8.8',
    '1.1.1.1',
    '93.184.215.14',
    '104.18.0.1',
  ),

  // IPv4-mapped IPv6, judged by the IPv4 rules
  ...refused('IPv4-mapped loopback, dotted', '::ffff:127.0.0.1'),
  ...refused('IPv4-mapped loopback, hex', '::ffff:7f00:1'),
  ...refused('IPv4-mapped metadata', '::ffff:169.254.169.254'),
  ...refused('IPv4-mapped private', '::ffff:10.0.0.1'),
  ...refused('IPv4-mapped unspecified', '::ffff:0.0.0.0'),
  ...allowed('IPv4-mapped public, dotted', '::ffff:8.8.8.8'),
  ...allowed('IPv4-mapped public, hex', '::ffff:808:808'),

  // IPv6 outside global unicast
  ...refused('IPv6 loopback', '::1'),
  ...refused('IPv6 unspecified', '::'),
  ...refused('IPv6 unique local', 'fd00::1', 'fd12:3456::1'),
  ...refused('IPv6 metadata', 'fd00:ec2::254'),
  ...refused('IPv6 link-local', 'fe80::1'),
  ...refused('IPv6 site-local', 'fec0::1'),
  ...refused('IPv6 multicast', 'ff02::1'),
  ...refused('IPv4-compatible loopback, dotted', '::127.0.0.1'),
  ...refused('IPv4-compatible loopback, hex', '::7f00:1'),
  ...refused('IPv4-translated loopback', '::ffff:0:7f00:1'),
  ...refused('NAT64 well-known prefix embedding loopback', '64:ff9b::7f00:1'),
  ...refused(
    'NAT64 well-known prefix embedding a private address',
    '64:ff9b::a00:1',
  ),
  ...refused('NAT64 local-use prefix', '64:ff9b:1::a00:1'),
  ...refused('IPv6 discard-only 100::/64', '100::1'),
  ...refused('IPv6 dummy prefix 100:0:0:1::/64', '100:0:0:1::1'),
  ...refused('IPv6 segment-routing SID', '5f00::1'),
  ...refused('IPv6 unassigned', '4000::1'),

  // The edges of global unicast, 2000::/3
  ...refused(
    'IPv6 either side of 2000::/3',
    '1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '4000::',
  ),
  ...allowed(
    'IPv6 global unicast 2000::/3, first and last',
    '2000::',
    '3fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
  ),

  // IPv6 special-purpose blocks inside global unicast, each with the public
  // addresses on either side
  ...refused(
    'IPv6 IETF protocol 2001::/23',
    '2001::',
    '2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff',
  ),
  ...refused('Teredo', '2001:0:4136:e378:8000:63bf:3fff:fdd2'),
  ...refused('IPv6 benchmarking', '2001:2::1'),
  ...refused('ORCHID', '2001:10::1'),
  ...allowed(
    'IPv6 either side of 2001::/23',
    '2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2001:200::',
  ),
  ...refused(
    'IPv6 documentation 2001:db8::/32',
    '2001:db8::',
    '2001:db8::1',
    '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff',
  ),
  ...allowed(
    'IPv6 either side of 2001:db8::/32',
    '2001:db7:ffff:ffff:ffff:ffff:ffff:ffff',
    '2001:db9::',
  ),
  ...refused(
    '6to4 2002::/16',
    '2002::',
    '2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
  ),
  ...refused('6to4 embedding loopback', '2002:7f00:1::1'),
  ...refused('6to4 embedding a private address', '2002:a00:1::1'),
  ...refused('6to4 embedding a public address', '2002:808:808::1'),
  ...allowed(
    'IPv6 either side of 2002::/16',
    '2001:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '2003::',
  ),
  ...refused(
    'IPv6 documentation 3fff::/20',
    '3fff::',
    '3fff::1',
    '3fff:fff::1',
    '3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff',
  ),
  ...allowed(
    'IPv6 either side of 3fff::/20',
    '3ffe:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '3fff:1000::',
    '3fff:1000::1',
  ),

  // IPv6 public
  ...allowed('IPv6 public', '2606:4700::1111', '2001:4860:4860::8888'),
  ...allowed('IPv6 public, bracketed', '[2606:4700::1111]'),

  // Not an IP literal
  ...refused('not an IP literal', 'not-an-address'),
];
