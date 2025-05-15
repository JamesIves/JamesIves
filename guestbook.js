const fs = require("fs");
const sanitizeHtml = require("sanitize-html");
const Filter = require("bad-words");
const { graphql } = require("@octokit/graphql");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Initialize the bad words filter
const filter = new Filter();

// Add custom bad words if necessary
filter.addWords("exampleBadWord1", "exampleBadWord2");

/**
 * Sanitizes the Guestbook Entry
 */
function sanitizeGuestbookEntry(comment) {
  const roundedAvatarUrl = `https://images.weserv.nl/?url=${encodeURIComponent(
    comment.author.avatarUrl
  )}&h=24&w=24&fit=cover&mask=circle&maxage=7d`;
  const authorLink = `[@${comment.author.login}](${comment.author.url})`;

  const sanitizedBodyText = sanitizeHtml(filter.clean(comment.bodyText), {
    allowedTags: [],
    allowedAttributes: {},
  });

  const formattedDate = new Date(comment.updatedAt).toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    }
  );

  return `<img width="24" height="24" align="center" src="${roundedAvatarUrl}" alt="${comment.author.login}"> ${sanitizedBodyText} - ${authorLink}\n> <sup>${formattedDate}</sup>\n`;
}

/**
 * Updates the Guestbook
 */
async function updateGuestbook() {
  const query = `query($owner:String!, $name:String!, $issue_number:Int!) {
    repository(owner:$owner, name:$name){
      issue(number:$issue_number) {
        comments(first:3, orderBy:{direction:DESC, field:UPDATED_AT}) {
          nodes {
            author {
              avatarUrl(size: 24)
              login
              url
            }
            bodyText
            updatedAt
          }
        }
      }
    }
  }`;

  const variables = {
    owner: "JamesIves",
    name: "JamesIves",
    issue_number: 1,
  };

  const graphqlWithAuth = graphql.defaults({
    headers: {
      authorization: `token ${GITHUB_TOKEN}`,
    },
  });

  const result = await graphqlWithAuth(query, variables);

  const guestbookEntries = result.repository.issue.comments.nodes
    .map((comment) => {
      return sanitizeGuestbookEntry(comment);
    })
    .join("\n");

  const readme = fs.readFileSync("README.md", "utf8");
  const updatedReadme = readme.replace(
    /(?<=<!--guestbook-->)[\s\S]*?(?=<!--guestbook-->)/,
    `\n\n${guestbookEntries}\n\n`
  );
  fs.writeFileSync("README.md", updatedReadme, "utf8");
}

updateGuestbook().catch((error) => {
  console.error(error);
  process.exit(1);
});
