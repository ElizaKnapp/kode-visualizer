# Deploying

The site runs as one nginx container in the hackweek AWS sandbox A, at
`https://eliza-knapp-kode-visualizer.a.hackweek.kikoff.dev`. The name only resolves on Kikoff's Twingate, so
only Kikoff people can open the page or run its install command. There's no sign-in and no secrets: it's a
static page, `install.sh` and the zip.

Infra's guide is
[Kikoff/infrastructure/projects/hackweek/CLAUDE.md](https://github.com/Kikoff/infrastructure/blob/main/projects/hackweek/CLAUDE.md).
This app follows its ECS recipe.

## Shipping a new version

With your AWS login fresh (`bash setup-aws.sh --profile hackweek-a`, from `Kikoff/infrastructure/projects/hackweek`)
and Docker running:

```bash
bin/release            # only when PR Map changed: rebuild the zip and install.sh, then commit them
bin/deploy             # build this commit, upload it, switch the site to it
bin/deploy --dry-run   # check everything and show what would change
bin/deploy --restart   # no new code: start fresh containers
```

`bin/deploy` refuses uncommitted changes, so the live site always matches a commit. It copies the live task
definition with only the image swapped. ECS starts the new version next to the old one and moves traffic only
once `/health` passes, so a broken build leaves the old one serving. At the end it downloads the page,
`install.sh` and the zip from the live URL.

A rebuilt zip has different bytes every time (timestamps inside), so only run `bin/release` when PR Map changed.
If the version changes, update the zip name in `index.html`; `bin/deploy` stops if the page links to a zip
that isn't there.

A brand-new DNS name can take about 4 minutes to reach Twingate. Until then the URL fails at the TLS handshake.

## What is deployed now

Set up 2026-10-07 by eliza.knapp@kikoff.com in sandbox A (632472162753, us-west-2). Everything is tagged
`project=kode-visualizer`, `owner=eliza.knapp@kikoff.com`, `created-by=eliza.knapp@kikoff.com`.

Expected: `/health` is `{"status":"ok"}`, and `/` is the page.

| What | ID |
| --- | --- |
| ECR repository | `hackweek-eliza-knapp-kode-visualizer` |
| IAM role | `hackweek-eliza-knapp-kode-visualizer-execution` (ECR pull and log writes only, permissions boundary set) |
| Log group | `/ecs/hackweek-eliza-knapp-kode-visualizer` (7 days) |
| ECS cluster / service | `hackweek-eliza-knapp-kode-visualizer` / `hackweek-eliza-knapp-kode-visualizer` |
| Load balancer | `arn:aws:elasticloadbalancing:us-west-2:632472162753:loadbalancer/app/hw-eliza-knapp-kode-vis/97ed382d9ef1b119` |
| Target group | `arn:aws:elasticloadbalancing:us-west-2:632472162753:targetgroup/hw-eliza-knapp-kode-vis-tg/a9dcb33c893e3bb2` |
| HTTPS listener | `arn:aws:elasticloadbalancing:us-west-2:632472162753:listener/app/hw-eliza-knapp-kode-vis/97ed382d9ef1b119/712989690444b9b4` |
| DNS record | `eliza-knapp-kode-visualizer.a.hackweek.kikoff.dev` A alias to `internal-hw-eliza-knapp-kode-vis-856239446.us-west-2.elb.amazonaws.com` (zone `Z1H1FL5HABSF5`), private zone `Z0108043AWPSA7N5M3A3` |

## Cleanup, in this order

The sandbox goes away Friday night. Delete only these resources.

1. `aws ecs update-service --cluster hackweek-eliza-knapp-kode-visualizer --service hackweek-eliza-knapp-kode-visualizer --desired-count 0`, then `aws ecs delete-service --cluster hackweek-eliza-knapp-kode-visualizer --service hackweek-eliza-knapp-kode-visualizer`
2. `aws ecs delete-cluster --cluster hackweek-eliza-knapp-kode-visualizer`, and deregister the task definitions
3. Delete the Route 53 record above (a DELETE change with the same alias it was created with)
4. `aws elbv2 delete-listener`, then `delete-load-balancer`, then `delete-target-group` (ARNs above)
5. `aws iam delete-role-policy --role-name hackweek-eliza-knapp-kode-visualizer-execution --policy-name pull-and-log`, then `aws iam delete-role --role-name hackweek-eliza-knapp-kode-visualizer-execution`
6. `aws logs delete-log-group --log-group-name /ecs/hackweek-eliza-knapp-kode-visualizer`
7. `aws ecr delete-repository --repository-name hackweek-eliza-knapp-kode-visualizer --force`

Never delete the shared certificate, the private zone, the VPC or the security group.
