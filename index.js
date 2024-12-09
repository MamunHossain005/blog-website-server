const express = require("express");
const cors = require("cors");
require("dotenv").config();
var jwt = require("jsonwebtoken");
var cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;

//built-in middleware
app.use(
	cors({
		origin: [
			"http://localhost:5173",
			"https://blog-website-client-e4937.web.app",
			"https://blog-website-client-e4937.firebaseapp.com"
		],
		credentials: true,
	})
);
app.use(express.json());
app.use(cookieParser());

//user defined middleware
const verifyToken = async (req, res, next) => {
	const token = req?.cookies?.token;

	if (!token) {
		return res.status(401).send({ message: "Unauthorized access" });
	}

	jwt.verify(token, process.env.JWT_ACCESS_SECRET, (err, decoded) => {
		if (err) {
			return res.status(401).send({ message: "Unauthorized access" });
		}

		req.user = decoded;
		next();
	});
};

const uri = `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGOR_PASS}@cluster0.meaaj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
	serverApi: {
		version: ServerApiVersion.v1,
		strict: false,
		deprecationErrors: true,
	},
	serverSelectionTimeoutMS: 50000,
});

const cookieOptions = {
	httpOnly: true,
	secure: process.env.NODE_ENV === "production" ? true : false,
	sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
	path: "/",
};

async function run() {
	try {
		// Connect the client to the server	(optional starting in v4.7)
		// await client.connect();

		const database = client.db("BloggyDB");
		const blogCollection = database.collection("blogCollection");
		const wishlistBlogCollection = database.collection("wishlistBlogs");
		const commentCollection = database.collection("comments");

		blogCollection.createIndex({ title: "text" });

		//auth related apis
		app.post("/jwt", async (req, res) => {
			const user = req.body;

			const token = jwt.sign(user, process.env.JWT_ACCESS_SECRET, {
				expiresIn: "1h",
			});

			res.cookie("token", token, cookieOptions).send({ success: true });
		});

		app.post("/logout", async (req, res) => {
			res
				.clearCookie("token", { ...cookieOptions, maxAge: 0 })
				.send({ success: true });
		});

		//blogs related apis
		//get all blogs
		app.get("/blogs", async (req, res) => {
			const cursor = blogCollection.find().sort({ date: -1 }).limit(6);
			const blogs = await cursor.toArray();
			res.send(blogs);
		});

		app.get("/allBlogs", async (req, res) => {
			const cursor = blogCollection.find().sort({ date: -1 });
			const blogs = await cursor.toArray();
			res.send(blogs);
		});

		//get blogs by pagination
		app.get("/paginationBlogs", async (req, res) => {
			const page = parseInt(req?.query?.page) || 1;
			const limit = parseInt(req?.query?.limit) || 6;
			const skip = (page - 1) * limit;

			let category = req?.query?.category;
			let title = req?.query?.title;

			const totalItems = await blogCollection.estimatedDocumentCount();
			const totalPages = Math.ceil(totalItems / limit);

			let blogs;

			if (category === "All") {
				if (title) {
					blogs = await blogCollection
						.find({
							$text: { $search: title },
						})
						.skip(skip)
						.limit(limit)
						.toArray();
				} else {
					blogs = await blogCollection.find().skip(skip).limit(limit).toArray();
				}
				return res.send({ blogs, totalPages });
			} else {
				let newBlogs;

				if (title) {
					newBlogs = blogCollection.find({
						$and: [{ category: category }, { $text: { $search: title } }],
					});
				} else {
					newBlogs = blogCollection.find({
						category: { $regex: category, $options: "i" },
					});
				}

				blogs = await newBlogs.toArray();
				return res.send({ blogs, totalPages });
			}
		});

		//get featured blogs
		app.get("/featuredBlogs", async (req, res) => {
			if (req.query.sort) {
				const [sortField, sortBy] = req.query.sort.split(':');
          		
				let newSortBy;
				if(sortBy === 'asc'){
					newSortBy = 1;
				}
				else if(sortBy === 'desc'){
					newSortBy = -1;
				}
				

				const cursor = blogCollection.aggregate([
					{
						$addFields: {
							wordCount: { $size: { $split: ["$long_description", " "] } },
						},
					},
					{
						$sort: { wordCount: -1 },
					},
					{
						$project: { wordCount: 0 }
					},
					{
						$limit: 10,
					},
					{
						$sort: {[sortField]: newSortBy}
					}
				]);

				const result = await cursor.toArray();
				res.send(result);

			} else {
				const cursor = blogCollection.aggregate([
					{
						$addFields: {
							wordCount: { $size: { $split: ["$long_description", " "] } },
						},
					},
					{
						$sort: { wordCount: -1 },
					},
					{
						$project: { wordCount: 0 }
					},
					{
						$limit: 10,
					}
				]);

				
				const result = await cursor.toArray();
				res.send(result);
			}
		});

		//get single blog
		app.get("/blogs/:id", async (req, res) => {
			const id = req.params.id;
			const query = { _id: ObjectId.createFromHexString(id) };
			const result = await blogCollection.findOne(query);
			res.send(result);
		});

		//update single blog
		app.put("/blogs/:id", async (req, res) => {
			const id = req.params.id;
			const blog = req.body;
			const filter = { _id: ObjectId.createFromHexString(id) };
			const options = { upsert: true };

			const updateBlog = {
				$set: {
					title: blog.title,
					image: blog.image,
					short_description: blog.short_description,
					long_description: blog.long_description,
					category: blog.category,
					blogger_name: blog.blogger_name,
					blogger_email: blog.blogger_email,
					date: blog.date,
				},
			};

			const result = await blogCollection.updateOne(
				filter,
				updateBlog,
				options
			);

			res.send(result);
		});

		//add single blog
		app.post("/blogs", async (req, res) => {
			const blog = req.body;
			const result = await blogCollection.insertOne(blog);
			res.send(result);
		});

		//get all wishlist blogs
		app.get("/wishlistBlogs", verifyToken, async (req, res) => {
			const loggedUserEmail = req?.query?.user;
			const userEmail = req?.user?.userEmail;

			if (loggedUserEmail !== userEmail) {
				return res.status(403).send({ message: "Forbidden access" });
			}

			let query = {};
			if (loggedUserEmail) {
				query = { email: loggedUserEmail };
			}

			const result = await wishlistBlogCollection
				.find(query)
				.sort({ wishlistDate: -1 })
				.toArray();
			res.send(result);
		});

		//get a comment
		app.get("/comments/:id", async (req, res) => {
			const id = req.params.id;
			const query = { blog_id: id };
			const result = await commentCollection.find(query).toArray();
			res.send(result);
		});

		//insert a comment
		app.post("/comments", async (req, res) => {
			const comment = req.body;
			const result = await commentCollection.insertOne(comment);
			res.send(result);
		});

		//insert blog in wishlist
		app.post("/wishlistBlogs", async (req, res) => {
			const blog = req.body;
			const query = { title: blog.title };
			const item = await wishlistBlogCollection.findOne(query);

			if (item) {
				res.send({ message: "The blog is already in the wishlist." });
			} else {
				const result = await wishlistBlogCollection.insertOne(blog);
				res.send(result);
			}
		});

		//delete blog from wishlist
		app.delete("/wishlistBlogs/:id", async (req, res) => {
			const id = req.params.id;
			const query = { _id: ObjectId.createFromHexString(id) };
			const result = await wishlistBlogCollection.deleteOne(query);
			res.send(result);
		});

		// Send a ping to confirm a successful connection
		// await client.db("admin").command({ ping: 1 });
		// console.log(
		// 	"Pinged your deployment. You successfully connected to MongoDB!"
		// );
	} finally {
		// Ensures that the client will close when you finish/error
		// await client.close();
	}
}
run().catch(console.dir);

app.get("/", (req, res) => {
	res.send("Bloggy server is running");
});

app.listen(port, () => {
	console.log(`Bloggy server is running on port: ${port}`);
});
