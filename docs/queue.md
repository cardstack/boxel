Our queue system is postgres based job queue system (resurrected from hub v2). This leverages postgres pub/sub capabilities to create a job queue system that implements our `Queue` interface (we previously created a mock queue that implements this same interface for browser testing).

The queue is controlled by the `jobs` table. We can monitor and control our queue using this table. The following is an example query of this table after running our tests. 

```
> SELECT * FROM JOBS;
 
 id | category  | args |  status  |         created_at         |        finished_at         |      queue      | result 
----+-----------+------+----------+----------------------------+----------------------------+-----------------+--------
  1 | increment | 17   | resolved | 2024-04-19 16:57:43.305961 | 2024-04-19 16:57:43.311274 | increment-queue | 18
```

On system start up we can register job handlers whose responsibility it is to run queued jobs (these handlers can horizontally scale if we so choose). A handler registration looks like this:
```ts
queue.register('increment', async (a: number) => a + 1);
```
This is a real simple example that just adds 1 to the job's input arguments. A handler ran return an async result as JSONB value which is stored in the `jobs.result` column of the `jobs` table. This handler defines  a "category" called `increment` for this function that it has registered. A handler processes the queue by looking for the oldest job that isn't running and handles that first.

Clients of the queue that wish to run jobs can do so by specifying the category of job that they wish to run, the queue that they wish to use, and input arguments for the job (the input arguments can be a JSONB value which is stored in the `jobs.args` column of the `jobs` table).
```ts
let job = await queue.publish<number>('increment', 17, {
  queueName: 'increment-queue',
});
```
The caller is handed a `job` object. This object has an `id` property and a `done` property that returns a promise for the job's return value (which is a parameterized type) when the job is completed. Note that the `queueName` is optional. If no name is supplied then the queue name `"default"` is used. The `queueName` is used to control job concurrency. Jobs are processed in each `queueName` serially.

When a job is first published to a queue it is assigned a status of `unfulfilled`. When a job has completed successfully it is assigned a status of `resolved`. If a job throws an error it is assigned a status of `rejected` and the error is serialized in the `jobs.result` column. 

Using SQL you can monitor the progress of the jobs in the queue, as well as, you can manipulate the results of the queue processing by setting `jobs.status`, `jobs.result`, and `jobs.queueName` using SQL. 