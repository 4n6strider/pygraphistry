#include "common.h"
#include "barnesHut/barnesHutCommon.h"

// Sort bodies in in-order traversal order
__kernel void sort(
        __global volatile float *x_cords,
        __global float *y_cords,
        __global volatile int* children,
        __global volatile int* start,
        __global int* sort,
        __global int* count,
        __global volatile int* step,
        __global volatile int* bottom,
        __global volatile int* maxdepth,
        __global volatile float* radiusd,
        __global volatile float* globalSpeed,
        unsigned int step_number,
        const int num_bodies,
        const int num_nodes
){
    debugonce("sort\n");

    int i, k, child, decrement, start_index, bottom_node;

    bottom_node = *bottom;
    decrement = get_global_size(0);
    k = num_nodes + 1 - decrement + get_global_id(0);
    while (k >= bottom_node) {
        start_index = start[k];
        if (start_index >= 0) {
            for (i = 0; i < 4; i++) {
                child = children[k*4+i];
                if (child >= num_bodies) {
                    // Child must be a cell
                    start[child] = start_index; // Set start ID of child
                    start_index += count[child]; // Add number of bodies in subtree
                } else if (child >= 0) {
                    // Child must be a body
                    sort[start_index] = child; // Record the body in 'sorted' array
                    start_index++;
                }
            }
            k -= decrement; // Go to next cell
        }
        mem_fence(CLK_GLOBAL_MEM_FENCE);
        //barrier(CLK_GLOBAL_MEM_FENCE); //TODO how to add throttle?
    }
}
