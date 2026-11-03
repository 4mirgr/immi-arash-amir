# GP / IMG / rural discovery map

Reviewed 2026-11-03. The source map is `cloud/gp-discovery-sources.json`: 19 public discovery links, at least one workforce source in every Australian state/territory, four clinic-network sources, official registration/support references and three publisher social-page links. All map records have `automation: link_only`. They are independent of the executable registry and must not be counted as active collectors or verified vacancies.

The map uses `state: AU` for national/multiple-jurisdiction sources. `trust: official` means the publisher's own website or a social-page URL explicitly published by that website; it does **not** mean government ownership, regulator endorsement or verified employment promises. Employer content is first-party advertising, not a regulatory interpretation.

## What was actually read

Fresh Firecrawl page retrieval was used for NSW RDN's rural GP application page and IMG employer guidance; RWAV's home page; Health Workforce Queensland's GP listings; Rural Health West's GP vacancies; RDWA's current-jobs portal; The People Project's jobs portal; NT PHN's GP page; CHN's careers and GP-vacancy pages; Canberra Health Services careers; Ochre Health, IPN, Doctors&Co and Family Doctor GP recruitment pages; the Rural Workforce Agencies Network and Medical Board PESCI page. Raw public receipts are outside the repository under `/workspace/scratch/gp-discovery/` and are disposable, not a recovery dependency.

RWAV's vacancy URL was followed as an explicit link from its reviewed home page, so the map states that narrower verification. Social URLs were obtained from publisher `article:publisher` metadata on RWAV, The People Project and NT PHN pages. The social-page contents and individual posts were **not** retrieved and must not be described as a live social feed. No personal profiles, private groups, accounts, cookies or direct messages were accessed.

## Geographic coverage and practical use

| Jurisdiction | Primary GP route | What to check next |
|---|---|---|
| NSW | [RDN recruitment](https://www.ruraldoctors.org/site/apply) links the rural vacancy portal and first-IMG support | Ask for current standard-pathway/registration/supervision matching, position-specific PESCI and sponsorship. The page still includes MDRAP wording; do not use it as sole current policy. |
| VIC | [RWAV vacancies](https://rwav.com.au/vacancies/) linked by RWAV's reviewed home page | Review actual vacancies, not a generic recruitment landing page, and ask about non-VR capacity. |
| QLD | [Health Workforce Queensland GP search](https://www.healthworkforce.com.au/jobs/general-practitioner) | Screen VR/Non-VR, location, Aboriginal Medical Services and employer conditions separately. |
| WA | [Rural Health West GP vacancies](https://ruralhealthwest.com.au/vacancies/general-practitioners/) | The source explicitly warns that some listed positions are not DPA. DPA, MMM, supervision and personal eligibility are separate checks. |
| SA | [RDWA current jobs](https://ruraldoc.com.au/current-jobs/) | Visible filters include non-VR, supervision capacity, training practice and IMG scheme; dynamic results still need reading. SAVES/locum examples can require fellowship. |
| TAS | [The People Project jobs](https://thepeopleproject.com.au/jobs/) | Use GP/GP-VMO/locum and geography categories; individual conditions override list-level sponsorship language. National RWA directory links HR+ with The People Project branding. |
| NT | [NT PHN GP careers](https://ntphn.org.au/health-careers/careers-by-profession/general-practitioner/) | Contact workforce team about private/not-for-profit/ACCHO matching and pre-fellowship options. This is not an individual offer. |
| ACT | [CHN GP vacancies](https://www.chnact.org.au/careers/external-primary-care-vacancies/general-practitioner-vacancies/) | Dedicated local clinic listings rather than substituting a university employment register for GP coverage. Canberra location does not establish rural/DPA/supervision eligibility. |

Clinic networks broaden discovery to smaller centres and local teams. Ochre exposes location, MMM1–7, DPA and VR/non-VR filters; IPN links state vacancy pages and mentions registrar/supervisor opportunities; Family Doctor exposes state, DPA and MMM filters and network nomination/support claims. **Doctors&Co's IMG section starts with recognised GP/Family Medicine specialist qualification**, so do not infer Arash qualifies merely because it mentions IMG or Standard Pathway. Every advertised pathway statement must be checked against Medical Board and college requirements.

## Social, supervisor and local-clinic research boundaries

Public publisher pages and indexed public post searches can reveal leads, but a post is not a verified vacancy. Verify the original clinic/agency advertisement, its date and application availability before promotion into the vacancy list. Preserve source URL and observed date; unknown deadline, sponsorship, registration, PESCI or supervision stays unknown. A public doctor's biography does not prove current supervision authority, approved capacity or willingness to sponsor. Use publicly published professional contact channels; do not infer personal contact information.

LinkedIn base OIDC/Share grants do not grant arbitrary post/profile/connection scraping. Facebook private groups and Telegram private channels need their own permitted access and are not silently read. No named Telegram group or supervisor was invented. Google/Bing searches restricted to public `linkedin.com/posts`, clinic pages or publicly indexed `t.me` pages may be offered as manual discovery actions, labeled unverified; no authenticated harvesting or recurring search service has been configured by this map.

No applications, subscriptions, posts or employer messages were submitted. Portal counts and salaries are deliberately omitted from durable records because they can change and list-level numbers do not establish a usable opening for Arash.
