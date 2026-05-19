const { logger } = require("../config/logger");

const CRITICAL_PORTS = new Set([22, 3389, 3306, 5432, 6379, 9200, 11211, 27017]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parsePolicyDocument(doc) {
  if (!doc) {
    return null;
  }
  if (typeof doc === "object") {
    return doc;
  }
  if (typeof doc === "string") {
    try {
      return JSON.parse(decodeURIComponent(doc));
    } catch {
      try {
        return JSON.parse(doc);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function statementHasWildcard(statement) {
  if (!statement || String(statement.Effect || "").toLowerCase() !== "allow") {
    return false;
  }

  const actions = asArray(statement.Action);
  const resources = asArray(statement.Resource);
  const hasWildcardAction =
    actions.includes("*") || actions.some((action) => /\*$/.test(String(action || "")));
  const hasWildcardResource =
    resources.length === 0 ||
    resources.includes("*") ||
    resources.some((resource) => String(resource).trim() === "*");

  return hasWildcardAction && hasWildcardResource;
}

class CloudMisconfigService {
  constructor({ awsSdk = null } = {}) {
    this.awsSdk = awsSdk;
  }

  resolveAwsSdk() {
    if (this.awsSdk) {
      return this.awsSdk;
    }
    try {
      // eslint-disable-next-line global-require
      return require("aws-sdk");
    } catch {
      return null;
    }
  }

  createAwsClients(credentials = {}) {
    const AWS = this.resolveAwsSdk();
    if (!AWS) {
      return null;
    }

    const config = {
      region: credentials.region || process.env.AWS_REGION || "us-east-1"
    };

    if (credentials.accessKeyId || process.env.AWS_ACCESS_KEY_ID) {
      config.accessKeyId = credentials.accessKeyId || process.env.AWS_ACCESS_KEY_ID;
      config.secretAccessKey =
        credentials.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;
      if (credentials.sessionToken || process.env.AWS_SESSION_TOKEN) {
        config.sessionToken = credentials.sessionToken || process.env.AWS_SESSION_TOKEN;
      }
    }

    return {
      s3Client: new AWS.S3(config),
      ec2Client: new AWS.EC2(config),
      iamClient: new AWS.IAM(config)
    };
  }

  async scanAWSAccount(credentials = {}, clients = null) {
    try {
      const resolvedClients = clients || this.createAwsClients(credentials);
      if (!resolvedClients) {
        logger.warn("AWS SDK unavailable; skipping cloud misconfiguration scan");
        return [];
      }

      const { s3Client, ec2Client, iamClient } = resolvedClients;
      logger.info("Starting AWS cloud misconfiguration scan");

      const [s3Issues, sgIssues, iamIssues] = await Promise.all([
        this.checkS3Buckets(s3Client),
        this.checkSecurityGroups(ec2Client),
        this.checkIAMPolicies(iamClient)
      ]);

      const issues = [...s3Issues, ...sgIssues, ...iamIssues];
      logger.info({ issues: issues.length }, "AWS cloud misconfiguration scan complete");
      return issues;
    } catch (error) {
      logger.error(
        { error: error?.message || String(error) },
        "AWS cloud misconfiguration scan failed"
      );
      return [];
    }
  }

  async checkS3Buckets(s3Client) {
    if (!s3Client || typeof s3Client.listBuckets !== "function") {
      return [];
    }

    try {
      const bucketsResp = await s3Client.listBuckets().promise();
      const buckets = asArray(bucketsResp?.Buckets);
      const issues = [];

      for (const bucket of buckets) {
        const bucketName = String(bucket?.Name || "").trim();
        if (!bucketName) {
          continue;
        }

        try {
          const acl = await s3Client.getBucketAcl({ Bucket: bucketName }).promise();
          const grants = asArray(acl?.Grants);
          const isPublic = grants.some((grant) => {
            const granteeType = String(grant?.Grantee?.Type || "").toLowerCase();
            const granteeUri = String(grant?.Grantee?.URI || "").toLowerCase();
            return (
              granteeType === "group" &&
              (granteeUri.includes("allusers") || granteeUri.includes("authenticatedusers"))
            );
          });
          if (isPublic) {
            issues.push({
              type: "CLOUD_MISCONFIGURATION",
              severity: "critical",
              category: "Cloud Configuration",
              title: `S3 bucket '${bucketName}' is publicly accessible`,
              description: `Bucket ACL grants public or broadly authenticated access.`,
              remediation:
                "Block public access at account and bucket level, then restrict bucket ACL/policy.",
              source: "cloud_misconfig_s3_acl",
              tags: ["cloud", "aws", "s3", "public-access"],
              metadata: {
                service: "S3",
                resource: bucketName
              }
            });
          }
        } catch (error) {
          logger.warn(
            { bucket: bucketName, error: error?.message || String(error) },
            "Unable to inspect S3 ACL"
          );
        }

        try {
          await s3Client
            .getBucketEncryption({
              Bucket: bucketName
            })
            .promise();
        } catch (error) {
          const code = String(error?.code || "");
          if (code === "ServerSideEncryptionConfigurationNotFoundError" || !code) {
            issues.push({
              type: "CLOUD_MISCONFIGURATION",
              severity: "high",
              category: "Cloud Configuration",
              title: `S3 bucket '${bucketName}' encryption is not enforced`,
              description:
                "Server-side encryption is not configured for this bucket by default.",
              remediation:
                "Enable default bucket encryption (SSE-S3 or SSE-KMS) and enforce encrypted uploads.",
              source: "cloud_misconfig_s3_encryption",
              tags: ["cloud", "aws", "s3", "encryption"],
              metadata: {
                service: "S3",
                resource: bucketName
              }
            });
          }
        }
      }

      return issues;
    } catch (error) {
      logger.warn(
        { error: error?.message || String(error) },
        "S3 bucket checks failed"
      );
      return [];
    }
  }

  async checkSecurityGroups(ec2Client) {
    if (!ec2Client || typeof ec2Client.describeSecurityGroups !== "function") {
      return [];
    }

    try {
      const response = await ec2Client.describeSecurityGroups().promise();
      const groups = asArray(response?.SecurityGroups);
      const issues = [];

      for (const group of groups) {
        const groupId = String(group?.GroupId || "unknown");
        const rules = asArray(group?.IpPermissions);
        for (const rule of rules) {
          const fromPort = Number.isFinite(Number(rule?.FromPort))
            ? Number(rule.FromPort)
            : -1;
          const toPort = Number.isFinite(Number(rule?.ToPort)) ? Number(rule.ToPort) : -1;

          const ipv4Open = asArray(rule?.IpRanges).some(
            (range) => String(range?.CidrIp || "").trim() === "0.0.0.0/0"
          );
          const ipv6Open = asArray(rule?.Ipv6Ranges).some(
            (range) => String(range?.CidrIpv6 || "").trim() === "::/0"
          );
          if (!ipv4Open && !ipv6Open) {
            continue;
          }

          const severity =
            fromPort === -1 || CRITICAL_PORTS.has(fromPort) || CRITICAL_PORTS.has(toPort)
              ? "critical"
              : "high";

          issues.push({
            type: "CLOUD_MISCONFIGURATION",
            severity,
            category: "Cloud Configuration",
            title:
              fromPort === -1
                ? `Security group ${groupId} allows open ingress on all ports`
                : `Security group ${groupId} allows open ingress on port ${fromPort}`,
            description:
              "Ingress rule permits access from any IP address (0.0.0.0/0 or ::/0).",
            remediation:
              "Restrict ingress CIDR ranges to trusted addresses or reference locked-down security groups.",
            source: "cloud_misconfig_security_group",
            tags: ["cloud", "aws", "ec2", "security-group"],
            metadata: {
              service: "EC2",
              resource: groupId,
              fromPort,
              toPort
            }
          });
        }
      }

      return issues;
    } catch (error) {
      logger.warn(
        { error: error?.message || String(error) },
        "Security group checks failed"
      );
      return [];
    }
  }

  async checkIAMPolicies(iamClient) {
    if (!iamClient || typeof iamClient.listUsers !== "function") {
      return [];
    }

    try {
      const usersResponse = await iamClient.listUsers().promise();
      const users = asArray(usersResponse?.Users);
      const issues = [];

      for (const user of users) {
        const userName = String(user?.UserName || "").trim();
        if (!userName) {
          continue;
        }

        try {
          const inlinePolicyList = await iamClient
            .listUserPolicies({ UserName: userName })
            .promise();
          for (const policyName of asArray(inlinePolicyList?.PolicyNames)) {
            const policyResponse = await iamClient
              .getUserPolicy({
                UserName: userName,
                PolicyName: policyName
              })
              .promise();
            const policyDoc = parsePolicyDocument(policyResponse?.PolicyDocument);
            const statements = asArray(policyDoc?.Statement);
            const wildcard = statements.some(statementHasWildcard);
            if (wildcard) {
              issues.push({
                type: "CLOUD_MISCONFIGURATION",
                severity: "critical",
                category: "Cloud Configuration",
                title: `IAM user '${userName}' has wildcard inline permissions`,
                description:
                  "Inline IAM policy allows broad action/resource wildcard access.",
                remediation:
                  "Refactor policy to least privilege and scope actions/resources to required services only.",
                source: "cloud_misconfig_iam_inline_policy",
                tags: ["cloud", "aws", "iam", "least-privilege"],
                metadata: {
                  service: "IAM",
                  resource: userName,
                  policyName
                }
              });
            }
          }
        } catch (error) {
          logger.warn(
            { userName, error: error?.message || String(error) },
            "Unable to inspect inline IAM policies"
          );
        }

        try {
          const attached = await iamClient
            .listAttachedUserPolicies({ UserName: userName })
            .promise();

          for (const policy of asArray(attached?.AttachedPolicies)) {
            const policyArn = String(policy?.PolicyArn || "").trim();
            if (!policyArn) {
              continue;
            }

            const policyMeta = await iamClient.getPolicy({ PolicyArn: policyArn }).promise();
            const defaultVersionId = policyMeta?.Policy?.DefaultVersionId;
            if (!defaultVersionId) {
              continue;
            }

            const version = await iamClient
              .getPolicyVersion({
                PolicyArn: policyArn,
                VersionId: defaultVersionId
              })
              .promise();
            const policyDoc = parsePolicyDocument(version?.PolicyVersion?.Document);
            const statements = asArray(policyDoc?.Statement);
            const wildcard = statements.some(statementHasWildcard);
            if (wildcard) {
              issues.push({
                type: "CLOUD_MISCONFIGURATION",
                severity: "high",
                category: "Cloud Configuration",
                title: `IAM user '${userName}' is attached to wildcard policy`,
                description:
                  "Attached IAM policy contains broad wildcard privileges that increase blast radius.",
                remediation:
                  "Replace broad managed policy with scoped roles and least-privilege controls.",
                source: "cloud_misconfig_iam_attached_policy",
                tags: ["cloud", "aws", "iam", "policy"],
                metadata: {
                  service: "IAM",
                  resource: userName,
                  policyArn
                }
              });
            }
          }
        } catch (error) {
          logger.warn(
            { userName, error: error?.message || String(error) },
            "Unable to inspect attached IAM policies"
          );
        }
      }

      return issues;
    } catch (error) {
      logger.warn(
        { error: error?.message || String(error) },
        "IAM policy checks failed"
      );
      return [];
    }
  }
}

module.exports = new CloudMisconfigService();
