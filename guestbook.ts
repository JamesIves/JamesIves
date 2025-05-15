import fs from "fs";
import sanitizeHtml from "sanitize-html";
import { graphql } from "@octokit/graphql";
import { Octokit } from "@octokit/rest";
import { Filter } from "bad-words";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

interface Author {
  avatarUrl: string;
  login: string;
  url: string;
}

interface Comment {
  id: number; // Added ID for deletion
  author: Author;
  bodyText: string;
  updatedAt: string;
}

interface GraphQLResponse {
  repository: {
    issue: {
      comments: {
        nodes: Comment[];
      };
    };
  };
}

/**
 * Sanitizes the Guestbook Entry
 */
function sanitizeGuestbookEntry(comment: Comment, filter: Filter): string {
  const roundedAvatarUrl = `https://images.weserv.nl/?url=${encodeURIComponent(
    comment.author.avatarUrl
  )}&h=24&w=24&fit=cover&mask=circle&maxage=7d`;
  const authorLink = `[@${comment.author.login}](${comment.author.url})`;

  /**
   * Clean, sanitize and prepare comment text
   */
  let processedText = filter.clean(comment.bodyText);

  /**
   * Strip HTML
   */
  processedText = sanitizeHtml(processedText, {
    allowedTags: [],
    allowedAttributes: {},
  });

  /**
   * Replace code blocks (triple backticks)
   */
  processedText = processedText.replace(
    /```[\s\S]*?```/g,
    "[code block removed]"
  );

  /**
   * Make single line by replacing all newlines with spaces
   */
  processedText = processedText.replace(/(\r\n|\n|\r)/gm, " ");

  /**
   * Trim and limit length if needed
   */
  processedText = processedText.trim();
  if (processedText.length > 200) {
    processedText = processedText.substring(0, 200) + "...";
  }

  const formattedDate = new Date(comment.updatedAt).toLocaleDateString(
    "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    }
  );

  return `<img width="24" height="24" align="center" src="${roundedAvatarUrl}" alt="${comment.author.login}"> ${processedText} - ${authorLink}\n> <sup>${formattedDate}</sup>\n`;
}

/**
 * Deletes a comment containing profanity
 */
async function deleteComment(commentId: number): Promise<void> {
  const octokit = new Octokit({
    auth: GITHUB_TOKEN,
  });

  console.log(`Deleting comment ${commentId} due to profanity`);

  await octokit.issues.deleteComment({
    owner: "JamesIves",
    repo: "JamesIves",
    comment_id: commentId,
  });
}

/**
 * Updates the Guestbook
 */
async function updateGuestbook(): Promise<void> {
  const filter = new Filter();

  const query = `query($owner:String!, $name:String!, $issue_number:Int!) {
    repository(owner:$owner, name:$name){
      issue(number:$issue_number) {
        comments(first:20, orderBy:{direction:DESC, field:UPDATED_AT}) {
          nodes {
            id: databaseId
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

  const result = await graphqlWithAuth<GraphQLResponse>(query, variables);
  const deletePromises: Promise<void>[] = [];
  let cleanComments: Comment[] = [];

  for (const comment of result.repository.issue.comments.nodes) {
    /**
     * Check for profanity
     */
    if (filter.isProfane(comment.bodyText)) {
      /**
       * Try to delete profane comments but continue if it fails
       */
      try {
        deletePromises.push(deleteComment(comment.id));
      } catch (error) {
        console.error(`Failed to delete comment ${comment.id}: ${error}`);
      }
    } else {
      /**
       * Only add non-profane comments
       */
      cleanComments.push(comment);
    }
  }

  /**
   * Process all deletion requests
   */
  if (deletePromises.length > 0) {
    try {
      await Promise.all(deletePromises);
    } catch (error) {
      console.error("Error deleting comments:", error);
    }
  }

  /**
   * Take only the first 3 clean comments
   */
  cleanComments = cleanComments.slice(0, 3);

  const guestbookEntries = cleanComments
    .map((comment: Comment) => {
      /**
       * Still filter comments during display as an extra precaution. This will mean that if a profane comment
       * appears it will be correctly censored.
       */
      return sanitizeGuestbookEntry(comment, filter);
    })
    .join("\n");

  const readme = fs.readFileSync("README.md", "utf8");
  const updatedReadme = readme.replace(
    /(?<=<!--guestbook-->)[\s\S]*?(?=<!--guestbook-->)/,
    `\n\n${guestbookEntries}\n\n`
  );
  fs.writeFileSync("README.md", updatedReadme, "utf8");
}

updateGuestbook().catch((error: Error) => {
  console.error(error);
  process.exit(1);
});
