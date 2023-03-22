const express = require("express");
const path = require("path");

const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const app = express(); // instanceof express.
app.use(express.json());

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;
const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(59111, () => {
      console.log("Server Running at http://localhost:59111/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};
initializeDBAndServer();

// API-1 register a user

app.post("/register/", async (request, response) => {
  const { username, name, password, gender } = request.body;
  const getUserDetailsQuery = `
  SELECT * FROM user WHERE username='${username}';`;

  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const databaseUserRow = await db.get(getUserDetailsQuery);
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      if (databaseUserRow === undefined) {
        const userRegisterQuery = `
                INSERT INTO user(username,password,name,gender)
                VALUES
                (
                    '${username}',
                    '${hashedPassword}',
                    '${name}',
                    '${gender}'
                    );`;
        await db.run(userRegisterQuery);
        response.send("User created successfully");
      } else {
        response.status(400);
        response.send("User already exists");
      }
    }
  } catch (error) {
    console.log(`sqlite error is ${error.message}`);
  }
});

// API-2 login a user

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const userGetQuery = `
    SELECT * FROM user WHERE username='${username}';`;
  const userGetRow = await db.get(userGetQuery);

  if (userGetRow === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatching = await bcrypt.compare(
      password,
      userGetRow.password
    );
    if (isPasswordMatching === true) {
      let payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "SECRET_KEY_59111");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// MiddleWare function

const authenticationTokenVerify = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }

  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    const verificationToken = jwt.verify(
      jwtToken,
      "SECRET_KEY_59111",
      async (error, payload) => {
        if (error) {
          response.status(401);
          response.send("Invalid JWT Token");
        } else {
          request.username = payload.username;
          next(); // go to handler function or next middle ware function.
        }
      }
    );
  }
};

// API-3 Returns the latest tweets of people whom the user follows. Return 4 tweets at a time
app.get(
  "/user/tweets/feed/",
  authenticationTokenVerify,
  async (request, response) => {
    const query1 = `SELECT user.username,tweet.tweet,tweet.date_time AS dateTime FROM (follower LEFT JOIN tweet ON follower.following_user_id=tweet.user_id)AS t1
    LEFT JOIN user ON t1.following_user_id=user.user_id
    WHERE follower.follower_user_id=(SELECT user_id FROM user WHERE username='${request.username}')
    ORDER BY tweet.date_time DESC
    LIMIT 4;`;
    const response1 = await db.all(query1);
    response.send(response1);
  }
);

// API-4 Returns the list of all names of people whom the user follows
app.get(
  "/user/following/",
  authenticationTokenVerify,
  async (request, response) => {
    const query2 = `SELECT user.name FROM follower LEFT JOIN user ON follower.following_user_id=user.user_id
    WHERE follower.follower_user_id=(SELECT user_id FROM user WHERE username='${request.username}');`;
    const response2 = await db.all(query2);
    response.send(response2);
  }
);

// API-5 Returns the list of all names of people who follows the user
app.get(
  "/user/followers/",
  authenticationTokenVerify,
  async (request, response) => {
    const query3 = `SELECT user.name FROM follower LEFT JOIN user ON follower.follower_user_id=user.user_id
    WHERE follower.following_user_id=(SELECT user_id FROM user WHERE username='${request.username}');`;
    const response3 = await db.all(query3);
    response.send(response3);
  }
);

// API-6  If the user requests a tweet of the user he is following, return the tweet, likes count, replies count and date-time

const isFollows = async (request, response, next) => {
  // another middle ware function
  const { tweetId } = request.params;
  const followingQuery = `SELECT * FROM follower
    WHERE follower.follower_user_id=(SELECT user_id FROM user WHERE username='${request.username}')
    AND
    follower.following_user_id=(SELECT user_id FROM tweet NATURAL JOIN user
        WHERE tweet.tweet_id=${tweetId});`;
  const followingResponse = await db.get(followingQuery);
  if (followingResponse === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next(); // move to a next handler function.
  }
};
app.get(
  "/tweets/:tweetId/",
  authenticationTokenVerify,
  isFollows,
  async (request, response) => {
    const { tweetId } = request.params;
    const { tweet, date_time } = await db.get(
      `SELECT * FROM tweet WHERE tweet.tweet_id=${tweetId};`
    );
    const repliesCount = await db.get(
      `SELECT COUNT(*) AS replyCounts FROM reply WHERE tweet_id=${tweetId};`
    );
    const likesCount = await db.get(
      `SELECT COUNT(*) AS likeCounts FROM like WHERE tweet_id=${tweetId};`
    );
    const response4 = {
      tweet,
      likes: likesCount.likeCounts,
      replies: repliesCount.replyCounts,
      dateTime: date_time,
    };
    response.send(response4);
  }
);

// API-7 If the user requests a tweet of a user he is following, return the list of usernames who liked the tweet
const convertArray = (eachObject) => {
  return eachObject.username;
};
app.get(
  "/tweets/:tweetId/likes/",
  authenticationTokenVerify,
  isFollows,
  async (request, response) => {
    const { tweetId } = request.params;
    const query5 = `SELECT user.username FROM user LEFT JOIN like ON user.user_id=like.user_id
    WHERE like.tweet_id=${tweetId};'`;
    const response5 = await db.all(query5);
    const usernameArray = response5.map((eachObject) =>
      convertArray(eachObject)
    );
    response.send({ likes: usernameArray });
  }
);

// API-8  If the user requests a tweet of a user he is following, return the list of replies.

app.get(
  "/tweets/:tweetId/replies/",
  authenticationTokenVerify,
  isFollows,
  async (request, response) => {
    const { tweetId } = request.params;
    const query6 = `SELECT user.name,reply.reply FROM user LEFT JOIN reply ON user.user_id=reply.user_id
    WHERE reply.tweet_id=${tweetId};'`;
    const response6 = await db.all(query6);
    response.send({ replies: response6 });
  }
);

// API-9 Returns a list of all tweets of the user
app.get(
  "/user/tweets/",
  authenticationTokenVerify,
  async (request, response) => {
    const query7 = `SELECT tweet.tweet,COUNT(DISTINCT like.like_id) AS likes,
    COUNT(DISTINCT reply.reply_id) AS replies,tweet.date_time AS dateTime FROM (tweet LEFT JOIN like ON tweet.tweet_id=like.tweet_id) AS t2
    LEFT JOIN reply ON reply.tweet_id=t2.tweet_id
    WHERE tweet.user_id=(SELECT user_id FROM user WHERE username='${request.username}')
    GROUP BY tweet.tweet_id`;
    const response7 = await db.all(query7);
    response.send(response7);
  }
);

// API-10 Create a tweet in the tweet table
app.post(
  "/user/tweets/",
  authenticationTokenVerify,
  async (request, response) => {
    const { tweet } = request.body;
    const { user_id } = await db.get(
      `SELECT user_id FROM user WHERE username='${request.username}';`
    );
    const query8 = `INSERT INTO tweet (tweet,user_id)
    VALUES ('${tweet}',${user_id})`;
    await db.run(query8);
    response.send("Created a Tweet"); // Created a Tweet
  }
);

// API-11     If the user requests to delete a tweet of other users
app.delete(
  "/tweets/:tweetId/",
  authenticationTokenVerify,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweet = `SELECT * FROM tweet WHERE tweet_id=${tweetId} AND user_id=(SELECT user_id FROM user
        WHERE username='${request.username}');`;
    const getResponse = await db.get(getTweet);
    if (getResponse === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteQuery = `DELETE FROM tweet WHERE tweet_id=${tweetId};`;
      await db.run(deleteQuery);
      response.send("Tweet Removed"); // Tweet Removed
    }
  }
);

module.exports = app;
